/**
 * Which microphone JARVIS listens to.
 *
 * Everything that opens the microphone asks here for its constraints, so the
 * choice is made in one place rather than being whatever Windows happens to
 * call the default. That default is not stable: a Bluetooth headset takes the
 * slot the moment it connects, and this machine has three active inputs, so
 * "he stopped hearing me" can be caused by nothing more than a headset waking
 * up in another room.
 *
 * The id is kept in localStorage because it is a per-machine preference and
 * has no business going anywhere near the bridge or an account.
 */

const KEY = 'jarvis.micDeviceId'

export type MicOption = {
  deviceId: string
  label: string
}

/** The chosen device id, or '' when following the system default. */
export function chosenMic(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    // Private windows and blocked site data both throw rather than return null.
    return ''
  }
}

export function setChosenMic(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(KEY, deviceId)
    else localStorage.removeItem(KEY)
  } catch {
    /* the choice simply will not persist */
  }
}

/**
 * Audio constraints for getUserMedia, with the chosen device when there is one.
 *
 * `exact` is deliberate. With a plain `deviceId` hint the browser is free to
 * ignore it and hand back the default anyway, which would make the picker look
 * like it worked while changing nothing. Failing loudly is better: the caller
 * can fall back to the default and say so.
 */
export function micConstraints(deviceId = chosenMic()): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
  if (deviceId) audio.deviceId = { exact: deviceId }
  return { audio }
}

/**
 * The input devices, newest labels first.
 *
 * Labels are empty until the page has been granted the microphone once, so
 * this is only worth calling after the voice loop has started. The entries are
 * returned as-is in that case rather than invented, and the caller shows the
 * device id instead.
 */
export async function listMics(): Promise<MicOption[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all
      .filter((d) => d.kind === 'audioinput')
      // 'communications' is Windows' phone-call slot and duplicates another
      // entry in this list; offering both invites picking the wrong one.
      .filter((d) => d.deviceId !== 'communications')
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${d.deviceId.slice(0, 6)}`,
      }))
  } catch {
    return []
  }
}
