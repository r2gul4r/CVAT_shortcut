"""Release safety tests; all Web Store requests are mocked, no credentials needed."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import publish_store as store
import release_notes as notes
import github_release as github
from release_gate import should_release


def revision(state, version):
    return {'state': state, 'distributionChannels': [{'crxVersion': version}]}


class ReleaseTests(unittest.TestCase):
    def test_ordinary_push_is_not_release(self):
        self.assertFalse(should_release('push', 'refs/heads/main', '2.2.1', '2.2.1'))

    def test_version_bump_releases(self):
        self.assertTrue(should_release('push', 'refs/heads/main', '2.2.1', '2.2.0'))

    def test_numeric_version_order(self):
        self.assertTrue(should_release('push', 'refs/heads/main', '2.10.0', '2.9.0'))

    def test_downgrade_fails(self):
        with self.assertRaises(ValueError):
            should_release('push', 'refs/heads/main', '2.1.0', '2.2.0')

    def test_unknown_previous_version_fails_closed(self):
        with self.assertRaises(ValueError):
            should_release('push', 'refs/heads/main', '2.2.1')

    def test_pull_requests_never_release(self):
        self.assertFalse(should_release('pull_request', 'refs/pull/1/merge', '2.2.1'))

    def test_other_branches_never_release(self):
        self.assertFalse(should_release('workflow_dispatch', 'refs/heads/test', '2.2.1'))

    def test_explicit_main_retry(self):
        self.assertTrue(should_release('workflow_dispatch', 'refs/heads/main', '2.2.1'))

    def test_chrome_equivalent_versions_do_not_release(self):
        self.assertFalse(should_release('push', 'refs/heads/main', '2.2.1.0', '2.2.1'))

    def test_invalid_version_rejected(self):
        for version in ('2.2.1\nfoo=bar', '2.2.01', '2.65536.0', '0.0.0'):
            with self.subTest(version=version), self.assertRaises(ValueError):
                notes.version_tuple(version)

    def test_history_matches_manifest_and_generated_page(self):
        history = notes.load_notes()
        self.assertEqual(notes.render(history), (ROOT / 'extension/updates.html').read_text(encoding='utf-8'))

    def test_notes_are_escaped_in_page(self):
        rendered = notes.render([{'version': '2.2.1', 'title': '<script>', 'changes': ['<img src=x onerror=evil>']}])
        self.assertNotIn('<script>', rendered)
        self.assertNotIn('<img', rendered)
        self.assertIn('&lt;script&gt;', rendered)

    def test_duplicate_history_versions_rejected(self):
        history = notes.load_notes()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'extension').mkdir()
            (root / 'extension/manifest.json').write_text(json.dumps({'version': history[0]['version']}))
            (root / 'release-notes.json').write_text(json.dumps([history[0], history[0]]))
            with self.assertRaises(ValueError):
                notes.load_notes(root)

    def run_submission(self, responses):
        calls = []
        def request(url, **kwargs):
            calls.append((url, kwargs))
            return responses.pop(0)
        result = store.submit('2.2.1', b'zip', 'publisher-123', 'test-secret', request=request, sleep=lambda _: None)
        return result, calls

    def test_success_submits_for_review_without_skip(self):
        result, calls = self.run_submission([{}, {'itemId': store.ITEM_ID, 'crxVersion': '2.2.1', 'uploadState': 'SUCCEEDED'}, {'itemId': store.ITEM_ID, 'state': 'PENDING_REVIEW'}])
        self.assertEqual(len(calls), 3)
        self.assertIn('PENDING_REVIEW', result)
        body = json.loads(calls[-1][1]['data'])
        self.assertEqual(body, {'publishType': 'DEFAULT_PUBLISH', 'skipReview': False, 'blockOnWarnings': True})
        self.assertIn('/upload/v2/publishers/publisher-123/items/' + store.ITEM_ID, calls[1][0])

    def test_async_upload_waits_before_publish(self):
        _, calls = self.run_submission([{}, {'itemId': store.ITEM_ID, 'uploadState': 'IN_PROGRESS'}, {'lastAsyncUploadState': 'IN_PROGRESS'}, {'lastAsyncUploadState': 'SUCCEEDED'}, {'itemId': store.ITEM_ID, 'state': 'PENDING_REVIEW'}])
        self.assertEqual([url.rsplit(':', 1)[-1] for url, _ in calls], ['fetchStatus', 'upload', 'fetchStatus', 'fetchStatus', 'publish'])

    def test_failed_upload_never_publishes(self):
        with self.assertRaisesRegex(RuntimeError, 'not attempted'):
            self.run_submission([{}, {'itemId': store.ITEM_ID, 'uploadState': 'FAILED'}])

    def test_async_timeout_never_publishes(self):
        with self.assertRaisesRegex(RuntimeError, 'not attempted'):
            self.run_submission([{}, {'itemId': store.ITEM_ID, 'uploadState': 'IN_PROGRESS'}] + [{'lastAsyncUploadState': 'IN_PROGRESS'}] * 30)

    def test_upload_wrong_version_never_publishes(self):
        with self.assertRaisesRegex(RuntimeError, 'version mismatch'):
            self.run_submission([{}, {'itemId': store.ITEM_ID, 'crxVersion': '9.0.0', 'uploadState': 'SUCCEEDED'}])

    def test_upload_wrong_item_never_publishes(self):
        with self.assertRaisesRegex(RuntimeError, 'item does not match'):
            self.run_submission([{}, {'itemId': 'different', 'uploadState': 'SUCCEEDED'}])

    def test_existing_review_is_idempotent(self):
        result, calls = self.run_submission([{'submittedItemRevisionStatus': revision('PENDING_REVIEW', '2.2.1')}])
        self.assertEqual(len(calls), 1)
        self.assertIn('Already submitted', result)

    def test_existing_published_is_idempotent(self):
        result, calls = self.run_submission([{'publishedItemRevisionStatus': revision('PUBLISHED', '2.2.1')}])
        self.assertEqual(len(calls), 1)
        self.assertEqual(result, 'Already published')

    def test_different_review_is_never_cancelled(self):
        with self.assertRaisesRegex(RuntimeError, 'no submission will be cancelled'):
            self.run_submission([{'submittedItemRevisionStatus': revision('PENDING_REVIEW', '2.2.0')}])

    def test_unknown_review_version_is_blocked(self):
        with self.assertRaises(RuntimeError):
            self.run_submission([{'submittedItemRevisionStatus': {'state': 'PENDING_REVIEW'}}])

    def test_newer_version_blocks_downgrade(self):
        with self.assertRaisesRegex(RuntimeError, 'newer version'):
            self.run_submission([{'publishedItemRevisionStatus': revision('PUBLISHED', '2.3.0')}])

    def test_unfinished_earlier_upload_is_blocked(self):
        with self.assertRaisesRegex(RuntimeError, 'earlier upload'):
            self.run_submission([{'lastAsyncUploadState': 'IN_PROGRESS'}])

    def test_store_warning_is_not_ignored(self):
        with self.assertRaisesRegex(RuntimeError, 'dashboard review'):
            self.run_submission([{'warned': True}])

    def test_rejected_response_does_not_report_success(self):
        with self.assertRaisesRegex(RuntimeError, 'uncertain'):
            self.run_submission([{}, {'itemId': store.ITEM_ID, 'uploadState': 'SUCCEEDED'}, {'itemId': store.ITEM_ID, 'state': 'REJECTED'}])

    def test_http_error_never_leaks_server_body_or_token(self):
        error = store.urllib.error.HTTPError('https://example.test', 401, 'secret-in-error', {}, None)
        with patch.object(store.urllib.request, 'urlopen', side_effect=error):
            with self.assertRaises(RuntimeError) as caught:
                store.request_json(store.API, token='test-secret')
        self.assertNotIn('secret', str(caught.exception))
        self.assertIn('401', str(caught.exception))

    def test_package_is_reproducible_and_includes_history(self):
        version = notes.load_notes()[0]['version']
        archive = ROOT / 'releases' / version / f'cvat-sidebar-shortcuts-{version}-ko.zip'
        command = [sys.executable, str(ROOT / 'tools/package-extension.py')]
        subprocess.run(command, check=True, capture_output=True)
        first = archive.read_bytes()
        subprocess.run(command, check=True, capture_output=True)
        self.assertEqual(first, archive.read_bytes())
        actual, _ = store.verified_package(archive)
        self.assertEqual(actual, version)
        with store.zipfile.ZipFile(archive) as package:
            self.assertIn('updates.html', package.namelist())
            self.assertIn('updates.css', package.namelist())

    def test_oauth_failure_reports_known_code_without_description(self):
        error = store.urllib.error.HTTPError('https://oauth2.googleapis.com/token', 400, 'private', {}, io.BytesIO(json.dumps({
            'error': 'invalid_grant', 'error_description': 'private-refresh-token',
        }).encode()))
        with patch.object(store.urllib.request, 'urlopen', side_effect=error), self.assertRaises(RuntimeError) as caught:
            store.request_json('https://oauth2.googleapis.com/token', data=b'private-client-secret')
        self.assertIn('OAuth token exchange failed: HTTP 400 (invalid_grant)', str(caught.exception))
        self.assertNotIn('private', str(caught.exception))

    def test_arbitrary_oauth_code_is_not_logged(self):
        stage, code, hint = store.error_context('https://oauth2.googleapis.com/token', {'error': 'private-token'})
        self.assertEqual(stage, 'OAuth token exchange')
        self.assertNotIn('private', code + hint)

    def test_web_store_error_has_operation_and_allowlisted_status(self):
        for operation, stage in [('fetchStatus', 'status check'), ('upload', 'upload'), ('publish', 'submission')]:
            with self.subTest(operation=operation):
                actual, code, hint = store.error_context(store.API + '/v2/publishers/private-id/items/item:' + operation,
                    {'error': {'status': 'PERMISSION_DENIED', 'message': 'private-token', 'details': ['private-body']}})
                self.assertEqual(actual, 'Web Store ' + stage)
                self.assertEqual(code, ' (PERMISSION_DENIED)')
                self.assertNotIn('private', actual + code + hint)

    def test_unexpected_error_body_is_not_echoed(self):
        for body in [['private-token'], {'error': {'status': ['private-token']}}, {'error': {'status': 'private-token'}}, None]:
            with self.subTest(body=body):
                self.assertNotIn('private', ' '.join(store.error_context(store.API, body)))

    def test_network_failure_identifies_stage_without_token(self):
        with patch.object(store.urllib.request, 'urlopen', side_effect=store.urllib.error.URLError('private-token')), self.assertRaises(RuntimeError) as caught:
            store.request_json(store.API + '/v2/item:fetchStatus', token='private-token')
        self.assertIn('Web Store status check', str(caught.exception))
        self.assertNotIn('private', str(caught.exception))

    def test_tampered_package_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'test.zip'
            archive.write_bytes(b'altered')
            archive.with_name('build-audit.json').write_text(json.dumps({'zip': archive.name, 'sha256': hashlib.sha256(b'original').hexdigest()}))
            with self.assertRaisesRegex(ValueError, 'build audit'):
                store.verified_package(archive)

    def github_case(self, tag_sha='commit', draft=True, existing_bytes=b'zip'):
        calls = []
        note = {'version': '2.2.1', 'title': 'Test', 'changes': ['Change']}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / 'releases/2.2.1'
            folder.mkdir(parents=True)
            archive = folder / 'cvat-sidebar-shortcuts-2.2.1-ko.zip'
            archive.write_bytes(b'zip')
            (folder / 'build-audit.json').write_bytes(b'audit')
            def gh(*args):
                calls.append(args)
                if args[0] == 'api' and 'matching-refs' in args[1]:
                    return json.dumps([{'ref': 'refs/tags/v2.2.1', 'object': {'type': 'commit', 'sha': tag_sha}}])
                if args[0] == 'api' and '/releases?' in args[1]:
                    return json.dumps([[{'tag_name': 'v2.2.1'}]])
                if args[:2] == ('release', 'view'):
                    return json.dumps({'isDraft': draft, 'body': notes.markdown(note), 'assets': [{'name': archive.name}]})
                if args[:2] == ('release', 'download'):
                    (Path(args[args.index('--dir') + 1]) / archive.name).write_bytes(existing_bytes)
                return ''
            with patch.object(github, 'ROOT', root), patch.object(github, 'load_notes', return_value=[note]), patch.object(github, 'verified_package'), patch.object(github, 'gh', side_effect=gh), patch.dict(github.os.environ, {'GITHUB_REPOSITORY': 'test/repo', 'GITHUB_SHA': 'commit', 'GITHUB_STEP_SUMMARY': ''}):
                github.main()
        return calls

    def test_existing_tag_on_different_commit_is_not_overwritten(self):
        with self.assertRaisesRegex(RuntimeError, 'another commit'):
            self.github_case(tag_sha='other')

    def test_changed_release_asset_is_not_overwritten(self):
        with self.assertRaisesRegex(RuntimeError, 'refusing to overwrite'):
            self.github_case(existing_bytes=b'changed')

    def test_partial_draft_resumes_missing_asset_then_publishes(self):
        calls = self.github_case()
        self.assertEqual(sum(args[:2] == ('release', 'upload') for args in calls), 1)
        self.assertEqual(calls[-1][:2], ('release', 'edit'))
        self.assertIn('--draft=false', calls[-1])

    def test_incomplete_public_release_is_not_silently_modified(self):
        with self.assertRaisesRegex(RuntimeError, 'missing an expected asset'):
            self.github_case(draft=False)


if __name__ == '__main__':
    unittest.main()
