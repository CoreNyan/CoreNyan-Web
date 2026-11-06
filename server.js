import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { LlmClient } from './core/llm-client.js';
import { ContextCompactor } from './core/compactor.js';
import { MemoryService } from './core/memory-service.js';
import { SkillService } from './core/skill-service.js';
import { PluginManager } from './core/plugin-manager.js';
import { createBuiltinTools } from './core/tool-registry.js';
import { Agent } from './core/agent.js';
import { authenticateBlessingSkinAdmin, createAuthSession, verifyAuthSession, revokeAuthSession } from './core/auth-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config', 'config.json');
const personaPath = path.join(__dirname, 'config', 'persona.json');
const providersPath = path.join(__dirname, 'config', 'providers.json');
const presetsPath = path.join(__dirname, 'config', 'presets.json');
const customPath = path.join(__dirname, 'config', 'customization.json');
const groupsPath = path.join(__dirname, 'config', 'groups.json');
const attachmentsDir = path.join(__dirname, 'data', 'attachments');
const TASK_TIMEOUT_MS = Number(process.env.FREECORE_MIND_TASK_TIMEOUT_MS || 10 * 60 * 1000);
const MAX_BODY_BYTES = Number(process.env.FREECORE_MIND_MAX_BODY_BYTES || 16 * 1024 * 1024);
const ACCOUNT_ORIGIN = process.env.FREECORE_ACCOUNT_ORIGIN || 'https://account.lynnhma.xyz';
const ACCOUNT_API_ORIGIN = ACCOUNT_ORIGIN;
const ACCOUNT_START_URL = `${ACCOUNT_API_ORIGIN}/api/freecore-launcher/start`;
const ACCOUNT_TOKEN_URL = `${ACCOUNT_API_ORIGIN}/api/freecore-launcher/token`;
fs.mkdirSync(attachmentsDir, { recursive: true });

let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (process.env.FREECORE_MIND_LLM_API_KEY) config.llm.apiKey = process.env.FREECORE_MIND_LLM_API_KEY;
if (process.env.FREECORE_MIND_LLM_BASE_URL) config.llm.baseURL = process.env.FREECORE_MIND_LLM_BASE_URL;
if (process.env.FREECORE_MIND_LLM_MODEL) config.llm.model = process.env.FREECORE_MIND_LLM_MODEL;
let persona = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
let providers = fs.existsSync(providersPath) ? JSON.parse(fs.readFileSync(providersPath, 'utf8')) : [];
if (process.env.FREECORE_MIND_LLM_API_KEY && providers[0]) providers[0].apiKey = process.env.FREECORE_MIND_LLM_API_KEY;
let presets = fs.existsSync(presetsPath) ? JSON.parse(fs.readFileSync(presetsPath, 'utf8')) : [];
let groups = fs.existsSync(groupsPath) ? JSON.parse(fs.readFileSync(groupsPath, 'utf8')) : [{ id: 'default', name: '默认会话' }];
let customization = fs.existsSync(customPath) ? JSON.parse(fs.readFileSync(customPath, 'utf8')) : { appName: 'FreeCore-Mind', appAvatar: 'assets/CoreNyan.png', userName: 'Lynn', userAvatar: 'assets/doodle/doodle_1.png', agentName: '小可', agentAvatar: 'assets/CoreNyan.png' };
const syncClients = new Set();
const activeTurns = new Map(); // sessionId -> { sessionId, startTime, author, avatar, userMessage, currentStep, lastEvent }
function broadcastSync(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of syncClients) {
    try { if (!client.destroyed && !client.writableEnded) client.write(data); else syncClients.delete(client); }
    catch { syncClients.delete(client); }
  }
}
function safeChildPath(root, rel) {
  const base = path.resolve(root), target = path.resolve(base, String(rel || ''));
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('Path escapes configured root');
  return target;
}
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data, 'utf8'); fs.renameSync(tmp, file);
}
function atomicJson(file, obj) { atomicWrite(file, JSON.stringify(obj, null, 2)); }
function redactProvider(p) { return p ? { ...p, apiKey: p.apiKey ? '••••••••' : '' } : p; }
function redactConfig(c) { const v = structuredClone(c); if (v.llm?.apiKey) v.llm.apiKey = '••••••••'; return v; }
const llmClient = new LlmClient(config.llm);
const compactor = new ContextCompactor(llmClient, { charThreshold: 25000, keepRecentTurns: 6 });
const memoryService = new MemoryService(config.paths.memoryVault);
const skillService = new SkillService(config.paths.skills);
const pluginManager = new PluginManager(path.join(__dirname, 'plugins'));
await pluginManager.loadPlugins();
const builtinTools = createBuiltinTools({ memoryService, skillService, pluginManager, workspaceRoot: config.paths.workspace || 'C:\\' });
const agent = new Agent({ llmClient, personaConfig: persona, memoryService, skillService, pluginManager, tools: builtinTools, sessionsDir: config.paths.sessions, compactor });
const mimeTypes = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml' };
function sendJson(res, status, data) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':process.env.FREECORE_MIND_ALLOWED_ORIGIN || '*','Access-Control-Allow-Methods':'GET, POST, DELETE, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' });
  res.end(JSON.stringify(data));
}
function getSessionIndex() {
  const dir = path.resolve(config.paths.sessions), indexPath = path.join(dir, 'index.json');
  let old=[]; try { const v=JSON.parse(fs.readFileSync(indexPath,'utf8')); if(Array.isArray(v)) old=v; } catch {}
  const byId=new Map();
  for(const x of old) if(x?.id && /^[\w.-]+$/.test(x.id) && fs.existsSync(path.join(dir,x.id+'.json'))) byId.set(x.id,x);
  try { for(const f of fs.readdirSync(dir,{withFileTypes:true})) { if(!f.isFile()||!f.name.endsWith('.json')||f.name==='index.json') continue; const id=f.name.slice(0,-5); if(!/^[\w.-]+$/.test(id)||byId.has(id)) continue; try { const s=JSON.parse(fs.readFileSync(path.join(dir,f.name),'utf8')); if(s.id===id) byId.set(id,{id,title:s.title||'新会话',groupId:s.groupId||'default',createdAt:s.createdAt||f.birthtimeMs,updatedAt:s.updatedAt||f.mtimeMs,messageCount:(s.messages||[]).filter(m=>['user','assistant'].includes(m.role)).length,pinned:false,archived:false}); } catch {} } } catch {}
  const list=[...byId.values()]; if(list.length!==old.length) try{atomicJson(indexPath,list)}catch{} return list;
}
function saveSessionIndex(list){ atomicJson(path.join(config.paths.sessions,'index.json'),list); }
const server = http.createServer(async (req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`), pathname=url.pathname;
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':process.env.FREECORE_MIND_ALLOWED_ORIGIN||'*','Access-Control-Allow-Methods':'GET, POST, DELETE, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'});res.end();return;}
  let token=(req.headers.authorization||'').startsWith('Bearer ')?req.headers.authorization.slice(7).trim():'';
  if(!token) token=(req.headers.cookie?.match(/(?:^|;\s*)fm_token=([^;]+)/)||[])[1]||'';
  const authUser=verifyAuthSession(token);
  try {
    if(pathname==='/api/auth/login'&&req.method==='POST'){
      let b='';for await(const c of req)b+=c;const {username,password}=JSON.parse(b||'{}');if(!username||!password)return sendJson(res,400,{error:'请输入账号与密码'});
      const result=await authenticateBlessingSkinAdmin(username.trim(),password);if(!result.success)return sendJson(res,401,{error:result.error||'登录失败'});
      const s=createAuthSession(result.user);res.setHeader('Set-Cookie',`fm_token=${s.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);return sendJson(res,200,{success:true,token:s.token,user:s.user});
    }
    if(pathname==='/api/auth/status'&&req.method==='GET')return sendJson(res,200,authUser?{authenticated:true,user:authUser}:{authenticated:false});
    if(pathname==='/api/auth/launcher/start'&&req.method==='GET'){
      const state=crypto.randomBytes(24).toString('base64url');
      const verifier=crypto.randomBytes(32).toString('base64url');
      const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
      try {
        const remote=await fetch(ACCOUNT_START_URL,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({challenge,state,clientToken:`freecore-mind-${crypto.randomBytes(16).toString('hex')}`}),signal:AbortSignal.timeout(10000)});
        const data=await remote.json().catch(()=>({}));
        if(!remote.ok||!data.authorizationUrl||!data.code)return sendJson(res,502,{error:'FreeCore-Account 授权服务暂不可用'});
        atomicJson(path.join(__dirname,'data',`launcher-auth-${state}.json`),{state,verifier,code:data.code,createdAt:Date.now()});
        res.setHeader('Set-Cookie',`fm_launcher_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
        return sendJson(res,200,{authorizationUrl:data.authorizationUrl,state});
      } catch(error) { return sendJson(res,502,{error:'无法连接 FreeCore-Account 授权服务'}); }
    }
    if(pathname==='/api/auth/launcher/callback'&&req.method==='GET'){
      const state=url.searchParams.get('state');
      const file=state&&/^[A-Za-z0-9_-]{20,128}$/.test(state)?path.join(__dirname,'data',`launcher-auth-${state}.json`):null;
      if(!file||!fs.existsSync(file))return sendJson(res,400,{error:'授权状态不存在或已过期'});
      const flow=JSON.parse(fs.readFileSync(file,'utf8'));
      try {
        const remote=await fetch(ACCOUNT_TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({code:flow.code,verifier:flow.verifier,state:flow.state}),signal:AbortSignal.timeout(10000)});
        const data=await remote.json().catch(()=>({}));
        if(remote.status===202)return sendJson(res,202,{pending:true});
        const account = data.account || data.session?.account || data.user?.account || {};
        const login = data.login || account.email;
        if (!remote.ok || !login) return sendJson(res, 502, { error: 'FreeCore-Account 授权未完成' });
        
        // 自动解析正版 Minecraft 头像与 UUID
        const profile = data.session?.selectedProfile || {};
        const realMojangUuid = account.minecraftUuid || (account.avatar?.match(/api\/avatar\/mojang\/([a-f0-9]+)/i)?.[1]) || null;
        const finalAvatar = realMojangUuid 
          ? `https://account.lynnhma.xyz/api/avatar/mojang/${realMojangUuid}` 
          : (account.avatar || `https://minotar.net/helm/${encodeURIComponent(data.player || profile.name || login)}/64.png`);

        const user = {
          uid: account.uid || data.uid || 1,
          email: login,
          nickname: account.nickname || data.player || profile.name || login,
          permission: Number(account.permission || 2),
          avatar: finalAvatar,
          minecraftUuid: realMojangUuid || profile.id || null
        };
        const session=createAuthSession(user);res.setHeader('Set-Cookie',`fm_token=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);try{fs.unlinkSync(file)}catch{};
        return sendJson(res,200,{authenticated:true,user});
      } catch(error) { return sendJson(res,502,{error:'无法连接 FreeCore-Account 授权服务'}); }
    }
    if(pathname==='/api/auth/logout'&&req.method==='POST'){revokeAuthSession(token);res.setHeader('Set-Cookie','fm_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');return sendJson(res,200,{success:true});}
    if(pathname.startsWith('/api/')&&!pathname.startsWith('/api/auth/')&&!authUser)return sendJson(res,401,{error:'未登录或登录已失效，请使用皮肤站管理员账号登录'});

    if(pathname==='/api/sessions'&&req.method==='GET'){
      let list=getSessionIndex(), archived=url.searchParams.get('archived')==='true', group=url.searchParams.get('groupId'), search=(url.searchParams.get('search')||'').toLowerCase();
      list=list.filter(x=>Boolean(x.archived)===archived);if(group)list=list.filter(x=>(x.groupId||'default')===group);
      if(search)list=list.filter(x=>(x.title||'').toLowerCase().includes(search)||(()=>{try{return fs.readFileSync(safeChildPath(config.paths.sessions,x.id+'.json'),'utf8').toLowerCase().includes(search)}catch{return false}})());
      list.sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))||(b.updatedAt||0)-(a.updatedAt||0));return sendJson(res,200,list);
    }
    if(pathname==='/api/sessions/reorder'&&req.method==='POST'){
      let b='';for await(const c of req)b+=c;const {sessionIds,targetGroupId,movedId}=JSON.parse(b||'{}');if(!Array.isArray(sessionIds))return sendJson(res,400,{error:'Invalid sessionIds array'});
      const list=getSessionIndex(),map=new Map(list.map(x=>[x.id,x])),ordered=[];for(const id of sessionIds)if(map.has(id)){const x=map.get(id);if(targetGroupId&&(!movedId||id===movedId))x.groupId=targetGroupId;ordered.push(x);map.delete(id)}ordered.push(...map.values());saveSessionIndex(ordered);return sendJson(res,200,{success:true,count:ordered.length});
    }
    if(pathname.startsWith('/api/sessions/')&&req.method==='GET'){
      const id=decodeURIComponent(pathname.slice('/api/sessions/'.length));if(!/^[\w.-]+$/.test(id))return sendJson(res,400,{error:'Invalid session id'});
      const file=safeChildPath(config.paths.sessions,id+'.json');if(!fs.existsSync(file))return sendJson(res,404,{error:'会话文件不存在'});return sendJson(res,200,JSON.parse(fs.readFileSync(file,'utf8')));
    }
    if(pathname==='/api/sessions'&&req.method==='POST'){
      let b='';for await(const c of req)b+=c;const {groupId}=JSON.parse(b||'{}');const id=`session-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,s=agent.loadSession(id);s.groupId=groupId||'default';agent.saveSession(s);return sendJson(res,200,s);
    }
    if(pathname.startsWith('/api/sessions/')&&req.method==='DELETE'){
      const id=decodeURIComponent(pathname.slice('/api/sessions/'.length));if(!/^[\w.-]+$/.test(id))return sendJson(res,400,{error:'Invalid session id'});const f=safeChildPath(config.paths.sessions,id+'.json');if(fs.existsSync(f))fs.unlinkSync(f);saveSessionIndex(getSessionIndex().filter(x=>x.id!==id));return sendJson(res,200,{success:true});
    }
    if(pathname==='/api/groups'&&req.method==='GET')return sendJson(res,200,groups);
    if(pathname==='/api/providers'&&req.method==='GET')return sendJson(res,200,providers.map(redactProvider));
    if(pathname==='/api/presets'&&req.method==='GET')return sendJson(res,200,presets);
    if(pathname==='/api/customization'&&req.method==='GET')return sendJson(res,200,customization);
    if(pathname==='/api/info'&&req.method==='GET')return sendJson(res,200,{persona,providers:providers.map(redactProvider),presets,customization,groups,skills:skillService.getCatalog(),tools:agent.getAllTools().map(t=>({name:t.function.name,description:t.function.description}))});
    if(pathname==='/api/settings'&&req.method==='GET')return sendJson(res,200,{config:redactConfig(config),persona,providers:providers.map(redactProvider),presets,customization,groups});

    if(pathname==='/api/chat'&&req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>MAX_BODY_BYTES)return sendJson(res,413,{error:'Request body too large'});}
      let parsed;try{parsed=JSON.parse(body||'{}')}catch{return sendJson(res,400,{error:'Invalid JSON body'});}
      const {sessionId,message,images,author,avatar,providerId,model,thinkingEffort,presetId,clientId}=parsed;
      if(!sessionId||!(/^[\w.-]+$/.test(String(sessionId)))||(!message&&(!images||!images.length)))return sendJson(res,400,{error:'Missing or invalid input'});
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no','Access-Control-Allow-Origin':process.env.FREECORE_MIND_ALLOWED_ORIGIN||'*'});
      const controller=new AbortController();let timedOut=false,settled=false;
      const timeout=setTimeout(()=>{timedOut=true;controller.abort(new Error('任务执行超时'))},TASK_TIMEOUT_MS);
      const userMessageObj = {
        role: 'user',
        content: message || '',
        images: images || [],
        author: author || authUser.nickname || 'LynnH_Ma',
        avatar: avatar || authUser.avatar || `https://mc-heads.net/avatar/${encodeURIComponent(authUser.nickname||'LynnH_Ma')}/64`,
        time: Date.now()
      };
      activeTurns.set(sessionId, {
        sessionId,
        startTime: Date.now(),
        userMessage: userMessageObj,
        lastEvent: null
      });
      const emit=evt=>{
        if(!res.destroyed&&!res.writableEnded){
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }
        const state = activeTurns.get(sessionId);
        if (state) state.lastEvent = evt;
        broadcastSync({type:'stream_event',sessionId,clientId,event:evt});
      };
      agent.activeTurnControllers.set(sessionId,controller);
      res.on('close',()=>{if(!res.writableEnded)controller.abort(new Error('客户端断开'));clearTimeout(timeout);if(agent.activeTurnControllers.get(sessionId)===controller)agent.activeTurnControllers.delete(sessionId);activeTurns.delete(sessionId);});
      try{
        broadcastSync({type:'turn_started',sessionId,clientId,userMessage:userMessageObj});
        await agent.runTurn({sessionId,userPrompt:message||'',images,author:author||authUser.nickname,avatar:avatar||authUser.avatar,provider:providers.find(p=>p.id===providerId)||providers[0]||null,model,thinkingEffort,preset:presets.find(p=>p.id===presetId)?.persona,onStream:emit,signal:controller.signal});
        settled=true;clearTimeout(timeout);if(agent.activeTurnControllers.get(sessionId)===controller)agent.activeTurnControllers.delete(sessionId);activeTurns.delete(sessionId);
        if(timedOut||controller.signal.aborted){const code=timedOut?'TASK_TIMEOUT':'TASK_ABORTED';emit({type:'task_stopped',code,error:timedOut?'任务执行超时，已自动中止。':'任务已中断。'});broadcastSync({type:'turn_interrupted',sessionId,clientId,code})}else broadcastSync({type:'turn_finished',sessionId,clientId});
        if(!res.writableEnded){res.write('data: [DONE]\n\n');res.end()}
      }catch(error){
        clearTimeout(timeout);if(agent.activeTurnControllers.get(sessionId)===controller)agent.activeTurnControllers.delete(sessionId);activeTurns.delete(sessionId);
        const aborted=controller.signal.aborted,code=timedOut?'TASK_TIMEOUT':aborted?'TASK_ABORTED':error.code||'TASK_FAILED';
        const messageOut=timedOut?'任务执行超时，已自动中止。':aborted?'任务已中断。':(error.message||'任务失败');
        console.error(`[chat] session=${sessionId} code=${code}: ${error.stack||messageOut}`);
        emit({type:'task_stopped',code,error:messageOut});broadcastSync({type:'turn_interrupted',sessionId,clientId,code});
        if(!res.writableEnded){res.write('data: [DONE]\n\n');res.end()}
      }
      return;
    }
    if(pathname==='/api/chat/interrupt'&&req.method==='POST'){
      let b='';for await(const c of req)b+=c;const {sessionId}=JSON.parse(b||'{}');const c=agent.activeTurnControllers.get(sessionId);if(c){c.abort(new Error('用户主动中断'));return sendJson(res,200,{success:true,interrupted:true})}return sendJson(res,200,{success:true,interrupted:false});
    }
    if(pathname==='/api/sync/events'&&req.method==='GET'){
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write(`data: ${JSON.stringify({type:'connected',time:Date.now(),activeTurns:[...activeTurns.values()]})}\n\n`);
      syncClients.add(res);
      req.on('close',()=>syncClients.delete(res));
      return;
    }
    if(pathname.startsWith('/attachments/')){const name=path.basename(pathname),f=path.join(attachmentsDir,name);if(fs.existsSync(f)){res.writeHead(200,{'Content-Type':mimeTypes[path.extname(f).toLowerCase()]||'application/octet-stream'});fs.createReadStream(f).pipe(res);return}}
    const reqPath=decodeURIComponent(pathname==='/'?'index.html':pathname.replace(/^\/+/,'')),staticRoot=path.resolve(__dirname,'web'),file=safeChildPath(staticRoot,reqPath);if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.writeHead(200,{'Content-Type':mimeTypes[path.extname(file).toLowerCase()]||'application/octet-stream'});fs.createReadStream(file).pipe(res);return}
    sendJson(res,404,{error:`Endpoint or file not found: ${pathname}`});
  }catch(error){console.error('[server]',error.stack||error.message);sendJson(res,500,{error:'Server Internal Error',detail:error.message})}
});
const PORT=Number(process.env.FREECOREMIND_PORT||config.server.port||25999),HOST=process.env.FREECOREMIND_HOST||config.server.host||'0.0.0.0';
server.listen(PORT,HOST,()=>console.log(`FreeCore-Mind Agent running at http://${HOST==='0.0.0.0'?'127.0.0.1':HOST}:${PORT}`));
