// Functional extractive baseline. No LLM agents or claim verifier are enabled.
export function cleanText(value=''){
 return String(value).replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[s]).replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,decimal)=>String.fromCodePoint(Math.min(hex?parseInt(hex,16):Number(decimal),0x10ffff))).replace(/\s+/g,' ').trim();
}
const stop=new Set('a an the of in on for to and or with what how does do is are can from about by using between effects effect role recent research evidence studies study'.split(' '));
export function queryTerms(query){return [...new Set(query.toLowerCase().match(/[a-z0-9]+/g)||[])].filter(t=>t.length>2&&!stop.has(t)).slice(0,14);}
export function searchExpression(query){const terms=queryTerms(query);return terms.length?terms.map(t=>'"'+t+'"').join(' AND '):'"'+query.replace(/["\\]/g,' ')+'"';}
export function summarize(papers,query,length='brief'){
 const terms=queryTerms(query),limit=length==='detailed'?8:4,insights=[];
 for(const paper of papers){const candidates=(paper.abstract.match(/[^.!?]+(?:[.!?]+|$)/g)||[]).map((text,index)=>({text:text.trim(),index})).filter(s=>s.text.length>=65&&s.text.length<=800);const score=s=>terms.reduce((n,t)=>n+(s.text.toLowerCase().includes(t)?2:0),0)+(/result|found|showed|suggest|conclud|improv|associated|however|limitation/i.test(s.text)?2:0);candidates.sort((a,b)=>score(b)-score(a)||a.index-b.index);if(candidates.length)insights.push({text:candidates[0].text,paperId:paper.id,sourceNumber:paper.number});if(insights.length>=limit)break;}return insights;
}
export function deduplicatePapers(papers){
 const output=[],keys=new Map();
 for(const paper of papers){const titleKey=paper.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');const doiKey=paper.doi?.toLowerCase();const existing=(doiKey?keys.get('doi:'+doiKey):undefined)??(titleKey?keys.get('title:'+titleKey):undefined);if(existing!==undefined){const old=output[existing];if(!old.abstract&&paper.abstract)output[existing]={...old,...paper};if(doiKey)keys.set('doi:'+doiKey,existing);continue;}const index=output.length;output.push(paper);if(titleKey)keys.set('title:'+titleKey,index);if(doiKey)keys.set('doi:'+doiKey,index);}
 return output.map((paper,index)=>({...paper,number:index+1}));
}
async function getJson(url){const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(22000)});if(!response.ok){const e=new Error(response.status===429?'This literature provider is busy. Please try again shortly or switch databases.':'The literature provider could not complete this search. Please try again.');e.status=response.status;throw e;}return response.json();}

// These providers return XML. Parse only their documented metadata elements;
// no external entities, DTDs, scripts or document-supplied URLs are executed.
export function xmlElements(xml,tag){
 const escaped=tag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return [...xml.matchAll(new RegExp('<'+escaped+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+escaped+'\\s*>','g'))].map(m=>({raw:m[0],inner:m[1]}));
}
function xmlText(xml,tag){return cleanText((xmlElements(xml,tag)[0]?.inner||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'));}
function xmlAttribute(raw,name){return cleanText(raw.match(new RegExp('\\b'+name+'\\s*=\\s*["\x27]([^"\x27]*)["\x27]'))?.[1]||'');}
export function parseArxivFeed(xml){
 if(!/<(?:\w+:)?feed\b/.test(xml))throw new Error('arXiv returned an unreadable response. Please try again later.');
 const entries=xmlElements(xml,'entry');
 if(entries.some(e=>xmlText(e.inner,'id').includes('/api/errors')))throw new Error('arXiv could not process this query. Try a shorter topic.');
 const papers=entries.map((entry,index)=>{const idText=xmlText(entry.inner,'id'),id=idText.match(/\/abs\/([^?#]+)/)?.[1];if(!id)return null;return {id:'arxiv:'+id,number:index+1,title:xmlText(entry.inner,'title'),authors:xmlElements(entry.inner,'author').map(a=>xmlText(a.inner,'name')).filter(Boolean).join(', '),year:Number(xmlText(entry.inner,'published').slice(0,4))||null,journal:xmlText(entry.inner,'arxiv:journal_ref')||'arXiv preprint',doi:xmlText(entry.inner,'arxiv:doi')||null,url:'https://arxiv.org/abs/'+id,abstract:xmlText(entry.inner,'summary'),source:'arXiv',publicationType:'preprint'};}).filter(Boolean);
 return {database:'arXiv',scope:'Research preprints · peer-review status varies',total:Number(xmlText(xml,'opensearch:totalResults'))||papers.length,papers:deduplicatePapers(papers)};
}
export function parsePubmedArticles(xml,ids=[]){
 if(!/<PubmedArticleSet\b/.test(xml))throw new Error('PubMed returned an unreadable response. Please try again later.');
 const articles=xmlElements(xml,'PubmedArticle').map((entry,index)=>{const citation=xmlElements(entry.inner,'MedlineCitation')[0]?.inner||entry.inner,article=xmlElements(citation,'Article')[0]?.inner||'',pmid=xmlText(citation,'PMID');if(!pmid)return null;const pubdate=xmlElements(article,'PubDate')[0]?.inner||'';const abstract=xmlElements(article,'Abstract')[0]?.inner||'';const doi=xmlElements(entry.inner,'ArticleId').find(e=>xmlAttribute(e.raw,'IdType')==='doi');return {id:'pubmed:'+pmid,number:index+1,title:xmlText(article,'ArticleTitle'),authors:xmlElements(article,'Author').map(a=>xmlText(a.inner,'CollectiveName')||[xmlText(a.inner,'LastName'),xmlText(a.inner,'Initials')||xmlText(a.inner,'ForeName')].filter(Boolean).join(' ')).filter(Boolean).join(', '),year:Number(xmlText(pubdate,'Year'))||Number(xmlText(pubdate,'MedlineDate').match(/\d{4}/)?.[0])||null,journal:xmlText(xmlElements(article,'Journal')[0]?.inner||'','Title'),doi:doi?cleanText(doi.inner):null,url:'https://pubmed.ncbi.nlm.nih.gov/'+pmid+'/',abstract:xmlElements(abstract,'AbstractText').map(a=>{const label=xmlAttribute(a.raw,'Label');return (label?label+': ':'')+cleanText(a.inner);}).join(' '),source:'PubMed'};}).filter(Boolean);
 if(ids.length)articles.sort((a,b)=>ids.indexOf(a.id.slice(7))-ids.indexOf(b.id.slice(7)));
 return deduplicatePapers(articles);
}
const metadataCache=new Map(),providerQueue=new Map(),providerNext=new Map(),pendingRequests=new Map();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function providerText(url,provider,accept){
 const key=url.toString(),cached=metadataCache.get(key);if(cached&&cached.expires>Date.now())return cached.text;if(pendingRequests.has(key))return pendingRequests.get(key);
 const previous=providerQueue.get(provider)||Promise.resolve();
 const task=previous.catch(()=>{}).then(async()=>{const wait=(providerNext.get(provider)||0)-Date.now();if(wait>0)await pause(wait);providerNext.set(provider,Date.now()+(provider==='arXiv'?3100:400));const response=await fetch(url,{headers:{Accept:accept,'User-Agent':'AgentReview/1.0 (literature discovery)'},signal:AbortSignal.timeout(25000)});if(!response.ok){const e=new Error(response.status===429?provider+' is rate limiting requests. Please wait before retrying or select another database.':provider+' is temporarily unavailable. Please try again later.');e.status=response.status;const raw=response.headers.get('Retry-After');e.retryAfter=Math.max(provider==='arXiv'?4:1,Number(raw)||Math.ceil((Date.parse(raw||'')-Date.now())/1000)||0);providerNext.set(provider,Date.now()+e.retryAfter*1000);throw e;}const text=await response.text();if(text.length>2000000)throw new Error(provider+' returned too much metadata. Try fewer papers.');metadataCache.set(key,{text,expires:Date.now()+600000});if(metadataCache.size>64)metadataCache.delete(metadataCache.keys().next().value);return text;});
 providerQueue.set(provider,task.catch(()=>{}));pendingRequests.set(key,task);try{return await task;}finally{pendingRequests.delete(key);}
}
async function retrieveArxiv(query,limit,year){
 const terms=queryTerms(query),expression=(terms.length?terms.map(term=>'all:'+term).join(' AND '):'all:"'+query.replace(/["\\]/g,' ')+'"')+(year?' AND submittedDate:['+year+'01010000 TO '+new Date().getUTCFullYear()+'12312359]':'');
 const url=new URL('https://export.arxiv.org/api/query');for(const[k,v]of Object.entries({search_query:expression,start:'0',max_results:String(limit),sortBy:'relevance',sortOrder:'descending'}))url.searchParams.set(k,v);
 return {...parseArxivFeed(await providerText(url,'arXiv','application/atom+xml')),searchExpression:expression};
}
async function retrievePubmed(query,limit,year){
 const expression=queryTerms(query).join(' ')||query,search=new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');for(const[k,v]of Object.entries({db:'pubmed',term:expression,retmode:'json',retmax:String(limit),sort:'relevance',tool:'AgentReview'}))search.searchParams.set(k,v);if(year){search.searchParams.set('datetype','pdat');search.searchParams.set('mindate',year+'/01/01');search.searchParams.set('maxdate',new Date().getUTCFullYear()+'/12/31');}
 const result=JSON.parse(await providerText(search,'PubMed','application/json'));if(result.error||result.esearchresult?.ERROR)throw new Error('PubMed could not process the query. Please try a simpler topic.');const ids=(result.esearchresult?.idlist||[]).filter(id=>/^\d+$/.test(id)).slice(0,limit);const base={database:'PubMed',scope:'Biomedical and life-sciences literature',total:Number(result.esearchresult?.count)||0,searchExpression:expression};if(!ids.length)return {...base,papers:[]};
 const detail=new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi');for(const[k,v]of Object.entries({db:'pubmed',id:ids.join(','),retmode:'xml',rettype:'abstract',tool:'AgentReview'}))detail.searchParams.set(k,v);
 return {...base,papers:parsePubmedArticles(await providerText(detail,'PubMed','application/xml'),ids)};
}
export async function retrievePapers(query,options={}){
 const limit=Math.min(12,Math.max(4,Number(options.limit)||8)),year=options.years==='5'?new Date().getUTCFullYear()-4:null;
 if(options.source==='arxiv')return retrieveArxiv(query,limit,year);
 if(!options.source||options.source==='pubmed')return retrievePubmed(query,limit,year);
 if(options.source==='semantic'){
  const url=new URL('https://api.semanticscholar.org/graph/v1/paper/search');url.searchParams.set('query',query);url.searchParams.set('limit',String(limit));url.searchParams.set('fields','title,authors,year,abstract,url,externalIds,openAccessPdf,venue');if(year)url.searchParams.set('year',year+'-');const data=await getJson(url);
  return {database:'Semantic Scholar',scope:'Multidisciplinary literature',total:data.total||0,papers:deduplicatePapers((data.data||[]).map((p,i)=>({id:p.paperId,number:i+1,title:cleanText(p.title),authors:(p.authors||[]).map(a=>a.name).join(', '),year:p.year||null,journal:p.venue||'',doi:p.externalIds?.DOI||null,url:p.url||'https://www.semanticscholar.org/paper/'+p.paperId,abstract:cleanText(p.abstract||''),source:'Semantic Scholar'})))};
 }
 const expression=searchExpression(query)+(year?' AND FIRST_PDATE:['+year+'-01-01 TO '+new Date().getUTCFullYear()+'-12-31]':'');const url=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');for(const [k,v]of Object.entries({query:expression,format:'json',resultType:'core',pageSize:String(limit)}))url.searchParams.set(k,v);const data=await getJson(url);
 return {database:'Europe PMC',scope:'Biomedical and life-sciences literature',total:data.hitCount||0,searchExpression:expression,papers:deduplicatePapers((data.resultList?.result||[]).map((p,i)=>({id:p.source+':'+p.id,number:i+1,title:cleanText(p.title),authors:p.authorString||'',year:Number(p.pubYear)||null,journal:p.journalInfo?.journal?.title||'',doi:p.doi||null,url:'https://europepmc.org/article/'+encodeURIComponent(p.source)+'/'+encodeURIComponent(p.id),abstract:cleanText(p.abstractText||''),source:'Europe PMC'})))};
}
export function makeReport(retrieval,query,options={}){
 const papers=retrieval.papers,insights=summarize(papers,query,options.length);return {query,createdAt:new Date().toISOString(),mode:'extractive',...retrieval,insights,checks:{sources:papers.length,withAbstract:papers.filter(p=>p.abstract).length,citedInsights:insights.length,verification:'not_connected'},limitations:['These excerpts come from available abstracts. They do not constitute a full-text review or establish scientific consensus.','Claim–evidence verification and the LLM agent backend are not connected.'],steps:[{name:'Searcher',detail:'Retrieved '+papers.length+' papers from '+retrieval.database+'.'},{name:'Parser',detail:'Normalized '+papers.filter(p=>p.abstract).length+' abstracts. No PDFs were parsed.'},{name:'Reader',detail:'Ranked abstract sentences by query relevance.'},{name:'Generator',detail:'Assembled '+insights.length+' exact, attributed excerpts.'},{name:'Judge',detail:'Checked source mappings and abstract availability. Semantic evaluation is pending.'}]};
}
