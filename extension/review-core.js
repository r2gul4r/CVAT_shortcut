/* Saved-annotation presence checks. Pure logic: no image access, network or writes. */
(() => {
  'use strict';
  const fail = message => { throw Error(message); };
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const list = (value, name) => Array.isArray(value) ? value : fail(`${name} 형식을 확인할 수 없습니다.`);
  function labels(values) {
    if(!Array.isArray(values) || values.length>5000)fail('라벨 목록을 확인할 수 없거나 라벨 수가 너무 많습니다.');
    const seen = new Set();
    return list(values, '라벨 목록').map(label => {
      if (!integer(label?.id) || label.id === 0 || seen.has(label.id) || typeof label.name !== 'string' || !label.name.trim()) fail('라벨 ID·이름을 확인할 수 없습니다.');
      seen.add(label.id);
      return {id:label.id, name:label.name.slice(0, 256), color:/^#[\da-f]{6}$/i.test(label.color) ? label.color : '#8996a8', type:label.type || 'any'};
    });
  }
  function frames(job, meta) {
    if (!integer(job?.start_frame) || !integer(job.stop_frame) || job.stop_frame < job.start_frame || job.dimension !== '2d') fail('2D Job의 프레임 범위를 확인할 수 없습니다.');
    if (!integer(meta?.start_frame) || !integer(meta.stop_frame) || meta.stop_frame < meta.start_frame) fail('프레임 메타데이터를 확인할 수 없습니다.');
    const filter = meta.frame_filter || '', match = /^step=([1-9]\d*)$/.exec(filter);
    if (filter && !match) fail('지원하지 않는 프레임 간격입니다.');
    const step = match ? Number(match[1]) : 1, length = job.stop_frame - job.start_frame + 1;
    if (!integer(step) || step < 1 || length > 200000 || Math.floor((meta.stop_frame-meta.start_frame)/step)+1 !== length) fail('프레임 번호가 일치하지 않거나 검사 범위가 너무 큽니다.');
    let included;
    if (meta.included_frames == null) included = Array.from({length}, (_, i) => i + job.start_frame);
    else {
      included = list(meta.included_frames, '포함 프레임').map(frame => {
        const relative = (frame-meta.start_frame)/step + job.start_frame;
        if (!integer(frame) || !integer(relative) || relative < job.start_frame || relative > job.stop_frame) fail('포함 프레임 번호가 올바르지 않습니다.');
        return relative;
      });
      if (new Set(included).size !== included.length) fail('포함 프레임 번호가 중복되었습니다.');
      included.sort((a,b)=>a-b);
    }
    // CVAT metadata's included/start/stop are source-frame numbers; deleted_frames
    // and annotations use task-relative CVAT frame numbers. Never add 1 for display.
    const deleted = new Set(list(meta.deleted_frames, '삭제 프레임'));
    if ([...deleted].some(frame => !integer(frame))) fail('삭제 프레임 번호가 올바르지 않습니다.');
    return {values:included.filter(frame => !deleted.has(frame)), excluded:included.filter(frame => deleted.has(frame)).length};
  }
  function ranges(values) {
    const result = [];
    for (const value of values) {
      const last = result[result.length-1];
      if (last && last[1]+1 === value) last[1] = value;
      else result.push([value,value]);
    }
    return result;
  }
  function contains(intervals, value) {
    let low=0, high=intervals.length-1;
    while (low<=high) { const mid=(low+high)>>1, [start,end]=intervals[mid]; if(value<start)high=mid-1;else if(value>end)low=mid+1;else return true; }
    return false;
  }
  function merge(intervals) {
    const result=[];
    intervals.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
    for (const [start,end] of intervals) { const last=result[result.length-1]; if(last && start<=last[1]+1)last[1]=Math.max(last[1],end);else result.push([start,end]); }
    return result;
  }
  function inspect(job, meta, annotations, catalog, required, mode='missing') {
    if(!['missing','present'].includes(mode))fail('지원하지 않는 라벨 검사 방식입니다.');
    const available=labels(catalog), byId=new Map(available.map(label=>[label.id,label]));
    if (!Array.isArray(required) || !required.length || required.length>200 || new Set(required).size!==required.length || required.some(id=>!byId.has(id))) fail('현재 Job의 라벨을 다시 선택하세요.');
    const {values,excluded}=frames(job,meta);
    if (!values.length) fail('삭제 프레임을 제외하면 검사할 프레임이 없습니다.');
    if (values.length*required.length>10000000) fail('한 번에 검사할 라벨 수를 줄여주세요.');
    if (!integer(annotations?.version)) fail('저장된 라벨링 버전을 확인할 수 없습니다.');
    const presence=new Map(required.map(id=>[id,[]]));
    for (const shape of list(annotations.shapes,'Shape 목록')) {
      if (!integer(shape?.frame) || !integer(shape.label_id) || typeof shape.type!=='string') fail('Shape의 라벨·프레임을 확인할 수 없습니다.');
      if (presence.has(shape.label_id) && shape.outside!==true) presence.get(shape.label_id).push([shape.frame,shape.frame]);
    }
    for (const track of list(annotations.tracks,'Track 목록')) {
      if (!integer(track?.label_id) || !integer(track.frame)) fail('Track의 라벨·프레임을 확인할 수 없습니다.');
      if (!presence.has(track.label_id)) continue;
      const keys=list(track.shapes,'Track 키프레임').slice().sort((a,b)=>a.frame-b.frame);
      // Skeleton parents can derive visibility from child tracks. Do not silently
      // call them missing when the deployment uses an unsupported representation.
      if (track.elements?.length || keys.some(key=>key.type==='skeleton')) fail('선택한 라벨의 Skeleton Track 검사는 아직 지원하지 않습니다.');
      if (!keys.length) fail('키프레임이 없는 Track을 확인할 수 없습니다.');
      keys.forEach((key,i)=>{
        if (!integer(key?.frame) || typeof key.outside!=='boolean' || (i && keys[i-1].frame===key.frame)) fail('Track의 Outside·키프레임을 확인할 수 없습니다.');
        if (!key.outside) presence.get(track.label_id).push([key.frame, i+1<keys.length ? keys[i+1].frame-1 : job.stop_frame]);
      });
    }
    // A frame tag is not a drawn object, even if it uses the same label ID.
    list(annotations.tags,'Tag 목록');
    const matchedUnion=new Set(),field=mode==='present'?'present':'missing';
    const rows=required.map(id=>{
      const intervals=merge(presence.get(id)), matched=values.filter(frame=>contains(intervals,frame)===(mode==='present'));
      matched.forEach(frame=>matchedUnion.add(frame));
      return {...byId.get(id),count:matched.length,[field]:ranges(matched)};
    });
    return {schema:1,mode,jobId:job.id,taskId:job.task_id,checkedAt:Date.now(),version:annotations.version,total:values.length,excluded,
      start:job.start_frame,end:job.stop_frame,[field+'Count']:matchedUnion.size,[field]:ranges([...matchedUnion].sort((a,b)=>a-b)),rows};
  }
  function page(intervals, offset=0, limit=30) {
    const result=[]; let skipped=0;
    for (const [start,end] of intervals) {
      const count=end-start+1;
      if(skipped+count<=offset){skipped+=count;continue;}
      for(let frame=start+Math.max(0,offset-skipped);frame<=end && result.length<limit;frame++)result.push(frame);
      skipped+=count; if(result.length===limit)break;
    }
    return result;
  }
  function adjacent(intervals, current, direction) {
    if(direction>0){for(const [start,end] of intervals)if(end>current)return Math.max(start,current+1);}
    else{for(let i=intervals.length-1;i>=0;i--){const [start,end]=intervals[i];if(start<current)return Math.min(end,current-1);}}
    return null;
  }
  const format = values => values.map(([a,b])=>a===b?String(a):`${a}~${b}`).join(', ');
  const resultRanges=(report,row=report)=>row?.[report?.mode==='present'?'present':'missing']||[];
  const resultCount=report=>report?.[report?.mode==='present'?'presentCount':'missingCount']||0;
  function text(report) {
    const present=report.mode==='present';
    return `Job ${report.jobId} · 저장된 작업 ${present?'라벨 검색':'검사'}\n${new Date(report.checkedAt).toLocaleString('ko-KR')} · ${report.total}프레임 · ${present?'찾은':'누락'} 프레임 ${resultCount(report)}개\n`+report.rows.map(row=>`${row.name}가 ${present?'있는':'없는'} 프레임: ${row.count?format(resultRanges(report,row)):'없음'} (${row.count}개)`).join('\n');
  }
  function csv(report) {
    if(report.rows.reduce((sum,row)=>sum+row.count,0)>200000)fail('CSV가 너무 큽니다. 라벨 수를 줄이거나 결과 복사를 사용하세요.');
    const cell=value=>'"'+String(value).replace(/^[\s]*[=+@-]/,value=>"'"+value).replaceAll('"','""')+'"';
    const lines=[['job_id','label_id','label',report.mode==='present'?'present_frame':'missing_frame','checked_at']];
    for(const row of report.rows)for(const [start,end] of resultRanges(report,row))for(let frame=start;frame<=end;frame++)lines.push([report.jobId,row.id,row.name,frame,new Date(report.checkedAt).toISOString()]);
    return '\ufeff'+lines.map(line=>line.map(cell).join(',')).join('\r\n');
  }
  const api=Object.freeze({labels,frames,inspect,ranges,contains,page,adjacent,format,resultRanges,resultCount,text,csv});
  globalThis.CVATReviewCore=api;
  if(typeof module!=='undefined')module.exports=api;
})();
