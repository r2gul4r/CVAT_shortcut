"""Submit a verified ZIP through Chrome Web Store API v2. No secret logging."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from release_notes import version_tuple

ITEM_ID = 'mphpnnnfkagcfnehdelfgabmaklmdnmm'
API = 'https://chromewebstore.googleapis.com'


def error_context(url, body):
    """Only fixed stage names and allowlisted codes may reach CI logs."""
    oauth = url == 'https://oauth2.googleapis.com/token'
    stage = 'OAuth token exchange' if oauth else {
        'fetchStatus': 'Web Store status check', 'upload': 'Web Store upload',
        'publish': 'Web Store submission',
    }.get(url.rsplit(':', 1)[-1], 'Web Store API')
    detail = body.get('error') if isinstance(body, dict) else None
    code = detail if oauth else detail.get('status') if isinstance(detail, dict) else None
    hints = {
        'invalid_grant': 'Refresh authorization was rejected. Reauthorize and replace CWS_REFRESH_TOKEN; check OAuth consent publishing status.',
        'invalid_client': 'Check CWS_CLIENT_ID and CWS_CLIENT_SECRET for the configured OAuth client.',
        'unauthorized_client': 'Check that the OAuth client is allowed to use the refresh-token flow.',
        'invalid_scope': 'Check the Chrome Web Store OAuth scope.',
        'access_denied': 'Check the account authorization and OAuth app access policy.',
    } if oauth else {
        'INVALID_ARGUMENT': 'Check publisher ID, extension package and request configuration in the Web Store dashboard.',
        'UNAUTHENTICATED': 'Check Web Store authorization.',
        'PERMISSION_DENIED': 'Check the publishing account and extension permissions.',
        'NOT_FOUND': 'Check the configured publisher and extension IDs.',
        'FAILED_PRECONDITION': 'Check the current item and review state in the Web Store dashboard.',
        'RESOURCE_EXHAUSTED': 'Check API quota and retry only after checking dashboard status.',
    }
    if isinstance(code, str) and code in hints:
        return stage, f' ({code})', hints[code]
    return stage, '', 'Check the Web Store dashboard and credentials.'


def request_json(url, data=None, token=None, content_type='application/json'):
    headers = {'Content-Type': content_type}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Never echo descriptions, URLs, request content or arbitrary response values.
        try:
            body = json.loads(error.read(16384))
        except (OSError, ValueError, AttributeError, TypeError):
            body = None
        stage, code, hint = error_context(url, body)
        raise RuntimeError(f'{stage} failed: HTTP {error.code}{code}. {hint}') from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        stage, _, _ = error_context(url, None)
        raise RuntimeError(f'{stage}: response unavailable; check dashboard status before retrying') from None


def preflight(status, version):
    if status.get('takenDown') or status.get('warned'):
        raise RuntimeError('Store warning/takedown requires dashboard review')
    published = status.get('publishedItemRevisionStatus') or {}
    submitted = status.get('submittedItemRevisionStatus') or {}
    for revision in (published, submitted):
        versions = [channel.get('crxVersion') for channel in revision.get('distributionChannels', [])]
        if any(value and version_tuple(value) > version_tuple(version) for value in versions):
            raise RuntimeError('A newer version already exists in the store')
    if submitted.get('state') in ('PENDING_REVIEW', 'STAGED'):
        versions = {channel.get('crxVersion') for channel in submitted.get('distributionChannels', [])}
        if versions == {version}:
            return 'Already submitted: ' + submitted['state']
        raise RuntimeError('Another or unidentified version is pending; no submission will be cancelled')
    if published.get('state') == 'PUBLISHED':
        versions = {channel.get('crxVersion') for channel in published.get('distributionChannels', [])}
        if versions == {version}:
            return 'Already published'
    return None


def submit(version, package, publisher, token, request=request_json, sleep=time.sleep):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', publisher):
        raise ValueError('Invalid publisher ID')
    name = f'publishers/{publisher}/items/{ITEM_ID}'
    endpoint = f'{API}/v2/{name}'
    status = request(endpoint + ':fetchStatus', token=token)
    existing = preflight(status, version)
    if existing:
        return existing
    if status.get('lastAsyncUploadState') == 'IN_PROGRESS':
        raise RuntimeError('An earlier upload is still processing; retry after it completes')
    uploaded = request(f'{API}/upload/v2/{name}:upload', data=package, token=token, content_type='application/zip')
    if uploaded.get('itemId') != ITEM_ID:
        raise RuntimeError('Upload response item does not match the configured extension')
    if uploaded.get('crxVersion') and uploaded['crxVersion'] != version:
        raise RuntimeError('Upload response version mismatch')
    state = uploaded.get('uploadState')
    for _ in range(30):
        if state != 'IN_PROGRESS':
            break
        sleep(10)
        state = request(endpoint + ':fetchStatus', token=token).get('lastAsyncUploadState')
    if state != 'SUCCEEDED':
        raise RuntimeError('Upload did not finish successfully; submission was not attempted')
    result = request(endpoint + ':publish', token=token, data=json.dumps({
        'publishType': 'DEFAULT_PUBLISH', 'skipReview': False, 'blockOnWarnings': True,
    }).encode())
    if result.get('itemId') != ITEM_ID or result.get('state') not in ('PENDING_REVIEW', 'PUBLISHED', 'STAGED'):
        raise RuntimeError('Submission result uncertain; inspect the dashboard before retrying')
    return 'Store state: ' + result['state']


def verified_package(archive):
    audit = json.loads(archive.with_name('build-audit.json').read_text(encoding='utf-8'))
    data = archive.read_bytes()
    if archive.name != audit['zip'] or hashlib.sha256(data).hexdigest() != audit['sha256']:
        raise ValueError('ZIP does not match its build audit')
    with zipfile.ZipFile(archive) as bundle:
        version = json.loads(bundle.read('manifest.json'))['version']
        if version != audit['version']:
            raise ValueError('ZIP version does not match its audit')
    version_tuple(version)
    return version, data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    version, package = verified_package(args.archive)
    names = ('CWS_PUBLISHER_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN')
    if any(not os.environ.get(name, '').strip() for name in names):
        raise SystemExit('Missing CWS configuration. See docs/automatic-release.md')
    form = urllib.parse.urlencode({
        'client_id': os.environ['CWS_CLIENT_ID'], 'client_secret': os.environ['CWS_CLIENT_SECRET'],
        'refresh_token': os.environ['CWS_REFRESH_TOKEN'], 'grant_type': 'refresh_token',
    }).encode()
    auth = request_json('https://oauth2.googleapis.com/token', data=form, content_type='application/x-www-form-urlencoded')
    token = auth.get('access_token')
    if not isinstance(token, str) or not token:
        raise SystemExit('OAuth token was not issued')
    # GitHub masks the short-lived access token as well as configured secrets.
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        print('::add-mask::' + token)
    result = submit(version, package, os.environ['CWS_PUBLISHER_ID'], token)
    print(result)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as output:
            output.write(f'### Chrome Web Store {version}\n{result}\n\nReview approval is controlled by Google.\n')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from None
