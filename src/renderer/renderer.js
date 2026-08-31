'use strict';

const api = window.deckDrone;
const $ = (id) => document.getElementById(id);
const state = { info: null, connected: false, armedAt: null, axes: { roll:0,pitch:0,throttle:0,yaw:0 }, commandFlags:0, videoFrame: false, cameraOrientations: { main: null, flow: null } };
let gamepadTakeoffTimer = null;
let settingsTimer = null;
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
  $('cameraUrl').replaceChildren(...urls.map((url) => { const option=document.createElement('option'); option.value=url; option.textContent=url.startsWith('wifi-uav://') ? `WiFi UAV native UDP — ${new URL(url).hostname}` : url; return option; }));
}
function applyProfileDefaults() {
  const profile = selectedProfile();
  if (profile.defaultHost) $('host').value = profile.defaultHost;
  if (profile.cameraUrl) addCameraOptions([profile.cameraUrl]);
  updateProfileUI();
}

function selectedCameraSource() { return $('cameraSource').value === 'flow' ? 'flow' : 'main'; }
function defaultCameraOrientation(source, url = $('cameraUrl').value) {
  if (!url.startsWith('wifi-uav://')) return 'normal';
  return source === 'main' ? 'mirror-horizontal' : 'normal';
}
function syncCameraOrientation() {
  const source = selectedCameraSource();
  $('cameraOrientation').value = state.cameraOrientations[source] || defaultCameraOrientation(source);
  applyCameraOrientation();
}
function currentSettings() {
  return { ssid: $('ssid').value, host: $('host').value, cameraUrl: $('cameraUrl').value, cameraSource: $('cameraSource').value, cameraOrientationMain: state.cameraOrientations.main, cameraOrientationFlow: state.cameraOrientations.flow, profile: $('profile').value, mode: $('mode').value, response: $('response').value, protocolConfirmed: $('protocolConfirmed').checked };
}
function applySettings(settings) {
  for (const key of ['ssid', 'host', 'cameraSource', 'mode', 'response']) if (typeof settings[key] === 'string' && $(key)) $(key).value = settings[key];
  const legacyOrientation = typeof settings.cameraOrientation === 'string' ? settings.cameraOrientation : null;
  state.cameraOrientations.main = typeof settings.cameraOrientationMain === 'string' ? settings.cameraOrientationMain : legacyOrientation;
  state.cameraOrientations.flow = typeof settings.cameraOrientationFlow === 'string' ? settings.cameraOrientationFlow : legacyOrientation;
  if (settings.profile && state.info.profiles[settings.profile]) $('profile').value = settings.profile;
  if (typeof settings.protocolConfirmed === 'boolean') $('protocolConfirmed').checked = settings.protocolConfirmed;
  if (settings.cameraUrl) addCameraOptions([settings.cameraUrl]);
  syncCameraOrientation();
  $('responseValue').textContent = `${$('response').value}%`; updateProfileUI();
}


function scheduleSettingsSave() {
  localStorage.setItem('droneSettings', JSON.stringify(currentSettings()));
  clearTimeout(settingsTimer); settingsTimer = setTimeout(() => api.saveSettings(currentSettings()).catch(() => {}), 150);
}

async function init() {
  state.info = await api.info();
  $('version').textContent = `v${state.info.version}`;
  for (const profile of Object.values(state.info.profiles)) {
    const option=document.createElement('option'); option.value=profile.id; option.textContent=profile.label; $('profile').append(option);
  }
  let localSettings = {}; try { localSettings = JSON.parse(localStorage.getItem('droneSettings') || '{}'); } catch (_) {}
  applySettings({ ...localSettings, ...(await api.loadSettings()) });
  bindEvents();
  scanDroneWifi({ silent: true });
  requestAnimationFrame(gamepadLoop);
}

function bindEvents() {
  $('profile').addEventListener('change', applyProfileDefaults);
  $('protocolConfirmed').addEventListener('change', updateProfileUI);
  $('host').addEventListener('input', updateProfileUI);
  $('ssid').addEventListener('change', async () => { $('profile').value=await api.suggestProfile($('ssid').value); applyProfileDefaults(); });
  $('response').addEventListener('input', () => $('responseValue').textContent=`${$('response').value}%`);
  for (const id of ['ssid', 'host', 'cameraUrl', 'profile', 'mode', 'response', 'protocolConfirmed']) $(id).addEventListener(id === 'response' || id === 'host' ? 'input' : 'change', scheduleSettingsSave);
  $('cameraSource').addEventListener('change', () => { syncCameraOrientation(); scheduleSettingsSave(); });
  $('cameraOrientation').addEventListener('change', () => { state.cameraOrientations[selectedCameraSource()] = $('cameraOrientation').value; applyCameraOrientation(); scheduleSettingsSave(); });

  $('discover').addEventListener('click', discover);
  $('scanDroneWifi').addEventListener('click', scanDroneWifi);
  $('joinDroneWifi').addEventListener('click', joinDroneWifi);
  $('startCamera').addEventListener('click', startCamera);
  $('stopCamera').addEventListener('click', stopCamera);
  $('camera').addEventListener('error', () => {
    if (!state.videoFrame) $('networkStatus').textContent='Waiting for the camera bridge to produce its first frame…';
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
  api.onVideoStatus((status) => {
    if (status.frame) { state.videoFrame = true; $('camera').style.display='block'; $('cameraPlaceholder').style.display='none'; }
    if (!status.frame && Number.isInteger(status.fragments)) { const sources = `Main ${status.mainCameraReady ? 'ready' : 'off'} · Bottom ${status.flowCameraReady ? 'ready' : 'off'}`; $('networkStatus').textContent = `Camera data: ${status.packets} UDP packets, ${status.fragments} fragments, ${status.frames || 0} frames. ${sources}`; }
    if(status.error){$('networkStatus').textContent=status.error;$('camera').style.display='none';$('cameraPlaceholder').style.display='flex';}
  });
  api.onVideoFrame((jpeg) => {
    state.videoFrame = true;
    $('camera').src = `data:image/jpeg;base64,${jpeg}`;
    $('camera').style.display='block'; $('cameraPlaceholder').style.display='none';
  });
  api.onVideoLog((message) => { if(message) $('networkStatus').textContent=message.slice(-90); });
  api.onUpdateStatus(updateStatus);
  window.addEventListener('beforeunload', () => { localStorage.setItem('droneSettings', JSON.stringify(currentSettings())); });
}

async function scanDroneWifi({ silent = false } = {}) {
  const button = $('scanDroneWifi'); button.disabled = true;
  if (!silent) $('networkStatus').textContent = 'Scanning Wi-Fi…';
  try {
    const result = await api.scanWifi();
    if (!result.available) { if (!silent) $('networkStatus').textContent = result.message; return; }
    const networks = result.networks || [];
    if (!networks.length) { if (!silent) $('networkStatus').textContent = 'No supported drone Wi-Fi found; keeping the last detected network.'; return; }
    $('wifiNetworks').replaceChildren(...networks.map((network) => { const option = document.createElement('option'); option.value = network.ssid; option.textContent = `${network.ssid} — ${network.signal}%`; return option; }));
    $('wifiNetworks').hidden = false; $('joinDroneWifi').disabled = false;
    $('ssid').value = networks[0].ssid; $('profile').value = await api.suggestProfile(networks[0].ssid); applyProfileDefaults();
    $('networkStatus').textContent = `Drone Wi-Fi detected: ${networks[0].ssid}. Press Join selected to connect.`;
  } catch (error) { $('networkStatus').textContent = error.message; }
  finally { button.disabled = false; }
}
async function joinDroneWifi() {
  const ssid = $('wifiNetworks').value;
  if (!ssid) return;
  $('joinDroneWifi').disabled = true; $('networkStatus').textContent = `Joining ${ssid}…`;
  try {
    await api.connectWifi(ssid); $('ssid').value = ssid; $('profile').value = await api.suggestProfile(ssid); applyProfileDefaults();
    $('networkStatus').textContent = `Joined ${ssid}. Discovering drone…`; await discover();
  } catch (error) { $('networkStatus').textContent = error.message; }
  finally { $('joinDroneWifi').disabled = false; }
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

function applyCameraOrientation() {
  $('camera').dataset.orientation = $('cameraOrientation').value;
}

async function startCamera() {
  const url=$('cameraUrl').value;
  if(!url) return;
  try {
    state.videoFrame = false;
    const source = url.startsWith('wifi-uav://') ? selectedCameraSource() : 'main';
    if (!state.cameraOrientations[source]) state.cameraOrientations[source] = defaultCameraOrientation(source, url);
    syncCameraOrientation();
    const result=await api.startVideo(url, source);
    // Frames are delivered directly over Electron IPC, avoiding browser multipart-stream decoding.
    $('camera').removeAttribute('src');
    $('camera').style.display='none'; $('cameraPlaceholder').style.display='flex';
    $('stopCamera').hidden = false;
    $('networkStatus').textContent = `${source === 'flow' ? 'Bottom / optical-flow' : 'Main / forward'} camera starting…`;
  } catch(error) { $('networkStatus').textContent=error.message; }
}

async function stopCamera() {
  try { await api.stopVideo(); }
  finally {
    state.videoFrame = false; $('camera').removeAttribute('src'); delete $('camera').dataset.orientation;
    $('camera').style.display='none'; $('cameraPlaceholder').style.display='flex'; $('stopCamera').hidden = true;
    $('networkStatus').textContent='Camera stopped.';
  }
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

function triggerControllerAction(id, flag) {
  if (!$(''+id).disabled) api.command(flag);
}

function gamepadFocusable() {
  return [...document.querySelectorAll('button, input, select')].filter((element) => !element.disabled && !element.hidden && element.getClientRects().length);
}
function setGamepadFocus(element) {
  document.querySelector('.gamepad-focus')?.classList.remove('gamepad-focus');
  element.classList.add('gamepad-focus'); element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function moveGamepadFocus(direction) {
  const items = gamepadFocusable(); if (!items.length) return;
  const current = items.includes(document.activeElement) ? document.activeElement : items[0];
  if (!items.includes(document.activeElement)) { setGamepadFocus(current); return; }
  const origin = current.getBoundingClientRect(); const ox = origin.left + origin.width / 2; const oy = origin.top + origin.height / 2;
  const candidates = items.filter((item) => item !== current).map((item) => {
    const rect = item.getBoundingClientRect(); const dx = rect.left + rect.width / 2 - ox; const dy = rect.top + rect.height / 2 - oy;
    const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    return { item, primary, secondary };
  }).filter((candidate) => candidate.primary > 3).sort((a, b) => (a.primary * 3 + a.secondary) - (b.primary * 3 + b.secondary));
  setGamepadFocus(candidates[0]?.item || current);
}
function adjustFocusedControl(step) {
  const focused = document.activeElement;
  if (focused instanceof HTMLSelectElement) {
    focused.selectedIndex = (focused.selectedIndex + step + focused.options.length) % focused.options.length;
    focused.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (focused instanceof HTMLInputElement && focused.type === 'range') {
    focused.value = String(Math.max(Number(focused.min || 0), Math.min(Number(focused.max || 100), Number(focused.value) + step * Number(focused.step || 1))));
    focused.dispatchEvent(new Event('input', { bubbles: true }));
  } else moveGamepadFocus(step < 0 ? 'left' : 'right');
}
function updateGamepadNavigation(pad) {
  if (state.connected) return;
  const previous = state.gamepadButtons || []; const pressed = (index) => Boolean(pad.buttons[index]?.pressed); const edge = (index) => pressed(index) && !previous[index];
  if (edge(12)) moveGamepadFocus('up'); if (edge(13)) moveGamepadFocus('down');
  if (edge(14)) adjustFocusedControl(-1); if (edge(15)) adjustFocusedControl(1);
  if (edge(0)) { const focused = document.activeElement; if (focused instanceof HTMLSelectElement) focused.click(); else if (gamepadFocusable().includes(focused)) focused.click(); }
}

function updateControllerShortcuts(pad) {
  const previous = state.gamepadButtons || [];
  const pressed = (index) => Boolean(pad.buttons[index]?.pressed);
  const edge = (index) => pressed(index) && !previous[index];
  if (edge(1)) triggerControllerAction('land', COMMAND.land);
  if (edge(2)) triggerControllerAction('headless', COMMAND.headless);
  if (edge(3)) triggerControllerAction('calibrate', COMMAND.calibrate);
  if (edge(5)) triggerControllerAction('emergency', COMMAND.emergency);
  if (edge(8) && !$('enableControl').disabled) $('enableControl').click();
  if (edge(9)) startCamera();
  if (pressed(0) && !previous[0] && !$('takeoff').disabled) {
    $('takeoff').textContent = 'KEEP HOLDING…';
    gamepadTakeoffTimer = setTimeout(() => { triggerControllerAction('takeoff', COMMAND.takeoff); $('takeoff').textContent = 'TAKEOFF SENT'; gamepadTakeoffTimer = null; }, 1200);
  }
  if (!pressed(0) && previous[0] && gamepadTakeoffTimer) { clearTimeout(gamepadTakeoffTimer); gamepadTakeoffTimer = null; $('takeoff').textContent = 'Hold to take off'; }
  state.gamepadButtons = pad.buttons.map((button) => Boolean(button.pressed));
}

function gamepadLoop() {
  const pad=navigator.getGamepads?.()[0];
  $('gamepadDot').classList.toggle('on',Boolean(pad)); $('gamepadText').textContent=pad ? (state.connected ? 'Flight controls active' : 'D-pad navigates • A activates') : 'Deck controls waiting';
  if(pad && state.info) {
    const deadman=Boolean(pad.buttons[4]?.pressed); // standard mapping: left bumper
    const gain=Number($('response').value)/100;
    updateGamepadNavigation(pad);
    updateControllerShortcuts(pad);
    const mapped=remap(Number($('mode').value),pad.axes);
    state.axes=Object.fromEntries(Object.entries(mapped).map(([key,value])=>[key,deadman?value*gain:0]));
    if(state.connected) api.updateFlight(state.axes);
    for(const key of ['roll','pitch','throttle','yaw']) $(''+key+'Bar').style.transform=`scaleX(${Math.max(.02,(state.axes[key]+1)/2)})`;
  } else if (state.gamepadButtons) { if (gamepadTakeoffTimer) clearTimeout(gamepadTakeoffTimer); gamepadTakeoffTimer = null; state.gamepadButtons = []; }
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
