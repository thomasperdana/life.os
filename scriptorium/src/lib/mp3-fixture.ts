/**
 * Generates a valid, silent MPEG-1 Layer III file of a known duration.
 * Test fixtures only — there is no encoder on this machine, and a real MP3 is
 * required to exercise duration, seeking, and range requests honestly.
 */
export function makeSilentMp3(seconds: number) {
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo, no CRC.
  const HEADER = [0xff, 0xfb, 0x90, 0x04]
  const SAMPLES_PER_FRAME = 1152
  const SAMPLE_RATE = 44100
  const BITRATE = 128000
  const frameLen = Math.floor((144 * BITRATE) / SAMPLE_RATE) // 417 bytes
  const frameSecs = SAMPLES_PER_FRAME / SAMPLE_RATE
  const frames = Math.max(1, Math.round(seconds / frameSecs))

  const id3 = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
  const out = new Uint8Array(id3.length + frames * frameLen)
  out.set(id3, 0)
  for (let i = 0; i < frames; i++) {
    out.set(HEADER, id3.length + i * frameLen) // rest of the frame stays zeroed = silence
  }
  return { bytes: out, frames, durationSeconds: frames * frameSecs }
}
