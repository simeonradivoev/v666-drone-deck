'use strict';

const api = window.deckDrone;
const $ = (id) => document.getElementById(id);
const state = { info: null, connected: false, armedAt: null, axes: { roll:0,pitch:0,throttle:0,yaw:0 }, commandFlags:0 };
const COMMAND = { takeoff:0x01, land:0x02, emergency:0x04, flip:0x08, headless:0x10, lock:0x20, unlock:0x40, calibrate:0x80 };

function setStatus(text, good = false) { $('linkBadge').textContent = text; $('linkBadge').className = `badge ${good ? 'safe' : 'danger'}`; }
function selectedProfile() { return state.info.profiles[$('profile').value]; }
function updateProfileUI() {
  const profile = selectedProfile();
  $('profileDescription').textContent = profile.description;
  $('profileBadge').textContent = profile.label.toUpperCase();
  $('enableControl').disabled = !profile.controlPort || !$('protocolConfirmed').checked || !$('host').value;
}

function addCameraOptions(urls) {
  $('cameraUrl').replaceChildren(...urls.map((url) => { const option=document.createElement('option');option.value=url;option.textContent=url;return option; }));
}

async function init() {
  state.info = await api.info();
  $('version').textContent = `v${state.info.version}`;
  for (const profile of Object.values(state.info.profiles)) {
    const option=document.createElement('option'); option.value=profile.id; option.textContent=profile.label; $('profile').append(option);
  }
  updateProfileUI();
  bindEvents();
  requestAnimationFrame(gamepadLoop);
}

function bindEvents() {
  $('profile').addEventListener('change', updateProfileUI);
  $('protocolConfirmed').addEventListener('change', updateProfileUI);
  $('host').addEventListener('input', updateProfileUI);
  $('ssid').addEventListener('change', async () => { $('profile').value=await api.suggestProfile($('ssid').value); updateProfileUI(); });
  $('response').addEventListener('input', () => $('responseValue').textContent=`${$('response').value}%`);
  $('discover').addEventListener('click', discover);
  $('startCamera').addEventListener('click', startCamera);
  $('camera').addEventListener('error', () => {
    $('camera').style.display='none'; $('cameraPlaceholder').style.display='flex';
    $('networkStatus').textContent='Camera bridge did not produce a frame. Try the next stream URL.';
  });
  $('enableControl').addEventListener('click', () => $('safetyDialog').showModal());
  $('acceptSafety').addEventListener('click', connectControl);
  $('takeoff').addEventListener('pointerdown', holdTakeoff);
  $('land').addEventListener('click', () => api.command(COMMAND.land));
  $('calibrate').addEventListener('click', () => api.command(COMMAND.calibrate));
  $('headless').addEventListener('click', () => api.command(COMMAND.headless));
  $('emergency').addEventListener('click', () => api.command(COMMAND.emergency));
  $('checkUpdate').addEventListener('click', async () => updateStatus(await api.checkUpdate()));
  $('installUpdate').addEventListener('click', () => api.installUpdate());
  $('importUpdate').addEventListener('click', async () => { const result=await api.importUpdate(); if(result) $('updateStatus').textContent=result.message; });
  api.onFlightStatus((status) => { state.connected=Boolean(status.connected); setStatus(status.connected ? 'CONTROL LINKED' : status.error || 'DISCONNECTED', status.connected); document.querySelectorAll('.action-grid button').forEach((button)=>button.disabled=!status.connected); });
  api.onVideoStatus((status) => { if(status.error){$('networkStatus').textContent=status.error;$('camera').style.display='none';$('cameraPlaceholder').style.display='flex';} });
  api.onVideoLog((message) => { if(message) $('networkStatus').textContent=message.slice(-90); });
  api.onUpdateStatus(updateStatus);
}

async function discover() {
  $('networkStatus').textContent='Scanning…';
  try {
    const result=await api.discover();
    if(result.host) $('host').value=result.host;
    addCameraOptions(result.cameraCandidates);
    const ports=result.openPorts.map((item)=>`${item.host}:${item.port}`).join(', ');
    $('networkStatus').textContent=ports ? `Found ${ports}` : `Gateway ${result.gateway || 'not found'}; no camera port answered`;
    updateProfileUI();
  } catch(error) { $('networkStatus').textContent=error.message; }
}

async function startCamera() {
  const url=$('cameraUrl').value;
  if(!url) return;
  try {
    const result=await api.startVideo(url);
    $('camera').src=`${result.feedUrl}?t=${Date.now()}`;
    $('camera').style.display='block'; $('cameraPlaceholder').style.display='none';
    $('networkStatus').textContent='Camera starting…';
  } catch(error) { $('networkStatus').textContent=error.message; }
}

async function connectControl() {
  try { await api.connect({ profileId:$('profile').value, host:$('host').value.trim() }); state.armedAt=Date.now(); }
  catch(error) { setStatus(error.message); }
}

function holdTakeoff(event) {
  const button=event.currentTarget; let fired=false;
  button.textContent='KEEP HOLDING…';
  const timer=setTimeout(()=>{ fired=true;api.command(COMMAND.takeoff);button.textContent='TAKEOFF SENT';},1200);
  const cancel=()=>{clearTimeout(timer);setTimeout(()=>button.textContent='Hold to take off',fired?800:0);button.removeEventListener('pointerup',cancel);button.removeEventListener('pointerleave',cancel)};
  button.addEventListener('pointerup',cancel); button.addEventListener('pointerleave',cancel);
}

function remap(mode, physical) {
  const maps=state.info.modes[mode] || state.info.modes[2];
  const result={roll:0,pitch:0,throttle:0,yaw:0};
  const values={leftX:physical[0]||0,leftY:-(physical[1]||0),rightX:physical[2]||0,rightY:-(physical[3]||0)};
  for(const [axis,channel] of Object.entries(maps)) result[channel]=Math.abs(values[axis])<.08?0:values[axis];
  return result;
}

function gamepadLoop() {
  const pad=navigator.getGamepads?.()[0];
  $('gamepadDot').classList.toggle('on',Boolean(pad)); $('gamepadText').textContent=pad?'Steam controls ready':'Deck controls waiting';
  if(pad && state.info) {
    const deadman=Boolean(pad.buttons[4]?.pressed); // standard mapping: left bumper
    const gain=Number($('response').value)/100;
    const mapped=remap(Number($('mode').value),pad.axes);
    state.axes=Object.fromEntries(Object.entries(mapped).map(([key,value])=>[key,deadman?value*gain:0]));
    if(state.connected) api.updateFlight(state.axes);
    for(const key of ['roll','pitch','throttle','yaw']) $(''+key+'Bar').style.transform=`scaleX(${Math.max(.02,(state.axes[key]+1)/2)})`;
  }
  if(state.armedAt) { const elapsed=Math.floor((Date.now()-state.armedAt)/1000); $('flightTimer').textContent=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`; }
  requestAnimationFrame(gamepadLoop);
}

function updateStatus(status) {
  if(!status) return;
  const text={checking:'Checking for updates…',current:'Current version is installed.',downloading:`Downloading update${status.percent==null?'…':` — ${status.percent}%`}`,ready:`v${status.version} staged. It can install without internet.`,error:status.message,development:status.message}[status.state];
  if(text) $('updateStatus').textContent=text;
  $('installUpdate').hidden=status.state!=='ready';
}

init();
