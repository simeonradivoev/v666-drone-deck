'use strict';

function clamp(value, limit) { return Math.max(-limit, Math.min(limit, value)); }

function calculateDriftAssist({ enabled, calibrated, deadman, manualRoll, manualPitch, manualYaw = 0, flow, now, rollSign = 1, pitchSign = 1, gain = 0.0025, limit = 0.12 }) {
  if (!enabled) return { roll: 0, pitch: 0, active: false, reason: 'Disabled' };
  if (!calibrated) return { roll: 0, pitch: 0, active: false, reason: 'Direction calibration required' };
  if (!deadman) return { roll: 0, pitch: 0, active: false, reason: 'Hold L1 to assist' };
  if (Math.abs(manualRoll) > .08 || Math.abs(manualPitch) > .08) return { roll: 0, pitch: 0, active: false, reason: 'Manual stick input takes priority' };
  if (Math.abs(manualYaw) > .08) return { roll: 0, pitch: 0, active: false, reason: 'Yaw input takes priority' };
  if (!flow || now - flow.timestamp > 350 || flow.confidence < .25) return { roll: 0, pitch: 0, active: false, reason: 'Fresh high-confidence bottom flow required' };
  return {
    roll: clamp(-flow.dx * gain * rollSign, limit),
    pitch: clamp(-flow.dy * gain * pitchSign, limit),
    active: true,
    reason: 'Correcting visual drift'
  };
}

if (typeof module !== 'undefined') module.exports = { calculateDriftAssist };
if (typeof window !== 'undefined') window.PositionAssist = { calculateDriftAssist };