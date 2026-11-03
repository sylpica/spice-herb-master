# 独立再集計（Claude Code 独立監査 2026-11-03、DECISIONS #54）
# アプリの TS・既存の検証スクリプト・生成メタを一切使わず、元の JSON / 画像ファイルから直接数える。
# 使い方: python3 -I scripts/independent-recount.py .   （リポジトリのルートを引数に渡す）
# 転記文字数は text・title・caption・表セルを数える。
import json,glob,collections,base64,re,os,sys,hashlib
R=sys.argv[1]; os.chdir(R)
out={}
def J(p): return json.load(open(p,encoding='utf-8'))
Q=[];[Q.extend(J(f)) for f in sorted(glob.glob('src/data/questions/formal-*.json'))]
C=[];[C.extend(J(f)) for f in sorted(glob.glob('src/data/questions/cards-*.json'))]
K=[];[K.extend(J(f)) for f in sorted(glob.glob('src/data/knowledge/*/*.json'))]
T=[];[T.extend(J(f)) for f in sorted(glob.glob('src/data/transcripts/*.json'))]
IMG=J('src/data/page-images.json')
out['questions']=len(Q); out['question_ids_unique']=len({q['id'] for q in Q})
fmt=collections.Counter(q['format'] for q in Q); out['formats']=dict(fmt); out['format_count']=len(fmt)
out['difficulty']=dict(sorted(collections.Counter(q['difficulty'] for q in Q).items()))
out['q_status']=dict(collections.Counter(q['status'] for q in Q))
out['cards']=len(C); out['card_ids_unique']=len({c['id'] for c in C})
out['card_kinds']=dict(collections.Counter(c.get('kind') for c in C)); out['card_status']=dict(collections.Counter(c['status'] for c in C))
EX={'short-essay','long-essay','compare-essay','composite'}
out['exam_pool']=sum(q['format'] not in EX for q in Q); out['exam_excluded']=sum(q['format'] in EX for q in Q)
out['knowledge_units']=len(K); out['ku_unique']=len({k['id'] for k in K}); out['ku_status']=dict(collections.Counter(k['status'] for k in K))
out['ku_batches']=len({(k.get('collation') or {}).get('batch') for k in K})
lp=[k for k in K if k['id']=='longpepper-profile']; out['longpepper']= {'batch':lp[0]['collation']['batch'],'content':lp[0]['content']} if lp else None
# 出典・参照整合
kid={k['id'] for k in K}
bad_ku=[q['id'] for q in Q if not q['knowledgeUnitIds'] or any(u not in kid for u in q['knowledgeUnitIds'])]
bad_ku_c=[c['id'] for c in C if not c['knowledgeUnitIds'] or any(u not in kid for u in c['knowledgeUnitIds'])]
out['q_bad_ku_refs']=bad_ku[:10]; out['q_bad_ku_count']=len(bad_ku); out['card_bad_ku_count']=len(bad_ku_c)
imgpage={i['imageId']:i['bookPage'] for i in IMG}
badref=[]
for x in Q+C:
  if not x['sourceRefs']: badref.append((x['id'],'none')); continue
  for s in x['sourceRefs']:
    if s['manifestImageId'] not in imgpage: badref.append((x['id'],'img?',s['manifestImageId']))
    elif imgpage[s['manifestImageId']]!=s['bookPage']: badref.append((x['id'],'page-mismatch',s['manifestImageId'],s['bookPage'],imgpage[s['manifestImageId']]))
out['sourceref_issues']=len(badref); out['sourceref_issue_samples']=badref[:8]
# 単一選択系
sc=[q for q in Q if q['format'] in('single-choice','reverse-lookup','figure')]
issues=collections.Counter()
for q in sc:
  ch=q['choices']
  if q['format']=='single-choice' and len(ch)!=4: issues['sc_not4']+=1
  if len(set(ch))!=len(ch): issues['dup_choice']+=1
  if len(q['correctChoiceIndexes'])!=1: issues['not_single_correct']+=1
  if any(i<0 or i>=len(ch) for i in q['correctChoiceIndexes']): issues['bad_index']+=1
for q in Q:
  if q['format']=='multiple-choice':
    if len(set(q['choices']))!=len(q['choices']): issues['mc_dup']+=1
    if len(q['correctChoiceIndexes'])<1: issues['mc_nocorrect']+=1
  if q['format'] in EX:
    if not q.get('rubric') or not q.get('modelAnswer'): issues['essay_missing_rubric']+=1
  if q['format'] in('one-answer','fill-blank','term-input') and not [a for a in q.get('acceptedAnswers',[]) if a.strip()]: issues['no_answers']+=1
  if q['format']=='ordering' and sorted(q['orderingItems'])!=sorted(q['correctOrder']): issues['order_mismatch']+=1
  if q['format']=='table-fill':
    blanks=re.findall(r'（空欄([A-Z])）',json.dumps(q['table'],ensure_ascii=False))
    if sorted(blanks)!=sorted(q['blankCellAnswers']): issues['table_blank_mismatch']+=1
  if not q['explanation'].strip(): issues['no_expl']+=1
  if not q['prompt'].strip(): issues['no_prompt']+=1
out['struct_issues']=dict(issues)
out['essays']=sum(q['format'] in('short-essay','long-essay','compare-essay') for q in Q)
# サンプル
blob=json.dumps(Q+C,ensure_ascii=False)
out['sample_status_q']=sum(q['status']=='sample' for q in Q); out['sample_status_c']=sum(c['status']=='sample' for c in C)
out['sample_id_like']=sum(1 for x in Q+C if re.match(r'^(s-|sample|q-sample|card-sample)',x['id']))
# 転記
out['transcript_records']=len(T); pages=[t['bookPage'] for t in T]; out['transcript_pages_unique']=len(set(pages))
out['transcript_dup_pages']=[p for p,c in collections.Counter(pages).items() if c>1]
def tchars(t):
  n=0
  for b in t['blocks']:
    for k in ('text','title','caption'):
      if isinstance(b.get(k),str): n+=len(b[k])
    if b.get('type')=='table' or 'rows' in b:
      for row in (b.get('rows') or []): n+=sum(len(c) for c in row if isinstance(c,str))
      for h in (b.get('headers') or []): n+=len(h) if isinstance(h,str) else 0
  return n
out['transcript_chars']=sum(tchars(t) for t in T)
out['transcript_page_range']=(min(p for p in pages if p), max(p for p in pages if p))
allp=set(range(6,148)); out['pages_not_transcribed']=sorted(allp-set(pages))
out['block_types']=dict(collections.Counter(b.get('type') for t in T for b in t['blocks']))
# 画像
files=sorted(glob.glob('public/pages-b64/*.b64')); out['image_files']=len(files); out['manifest_images']=len(IMG)
imgerr=[];hashes=collections.defaultdict(list)
for f in files:
  raw=open(f,'rb').read().strip()
  try: b=base64.b64decode(raw,validate=True)
  except Exception as e: imgerr.append((f,'b64')); continue
  if not(b[:4]==b'RIFF' and b[8:12]==b'WEBP'): imgerr.append((f,'notwebp')); continue
  hashes[hashlib.sha1(b).hexdigest()].append(os.path.basename(f))
  # VP8/VP8L/VP8X 寸法
  ck=b[12:16]
  if ck==b'VP8X': w=1+int.from_bytes(b[24:27],'little'); h=1+int.from_bytes(b[27:30],'little')
  elif ck==b'VP8 ': w=int.from_bytes(b[26:28],'little')&0x3fff; h=int.from_bytes(b[28:30],'little')&0x3fff
  elif ck==b'VP8L': v=int.from_bytes(b[21:25],'little'); w=(v&0x3fff)+1; h=((v>>14)&0x3fff)+1
  else: w=h=None
  if w!=1000: imgerr.append((f,'w',w,h))
  m=[i for i in IMG if i['imageId']==os.path.basename(f)[:-4]]
  if not m: imgerr.append((f,'not-in-manifest'))
  elif (m[0]['width'],m[0]['height'])!=(w,h): imgerr.append((f,'dim-mismatch',w,h,m[0]['width'],m[0]['height']))
out['image_errors']=imgerr; out['image_dup_hashes']=[v for v in hashes.values() if len(v)>1]
nums=sorted(int(os.path.basename(f)[4:8]) for f in files)
out['image_missing_numbers']=sorted(set(range(9577,9724))-set(nums))
rule=[]
for i in IMG:
  n=int(i['imageId'][4:]); p=i['bookPage']
  if p is None: continue
  exp = n-9575 if n-9575<=71 else n-9576
  if p!=exp: rule.append((i['imageId'],p,exp))
out['page_rule_violations']=rule; out['images_no_page']=[i['imageId'] for i in IMG if i['bookPage'] is None]
# 節
st=open('src/data/structure.ts',encoding='utf-8').read()
out['sections']=len(re.findall(r'"transcriptionStatus"',st))
out['search_total_expected']=out['sections']+len(Q)
# 改訂
rv=open('src/data/revision.ts',encoding='utf-8').read()
out['revision_file_len']=len(rv)
# キーワード監査
allsrc=''.join(open(f,encoding='utf-8').read() for f in glob.glob('src/**/*.*',recursive=True) if f.endswith(('.json','.ts','.tsx')))
for w in ['ピパーチ','ピバーチ','コーリーコード','コーリコード','サッサフラス','sample','サンプル']:
  out['grep_'+w]=allsrc.count(w)
print(json.dumps(out,ensure_ascii=False,indent=1))
