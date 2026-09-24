import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {requireThat, sha256, writeNew, MAX_ASSET} from './binary.mjs';

const HEADER_SIZE = 0x8000;
const runtime = fileURLToPath(new URL('../tools/media/runtime/ffmpeg-n8.1-latest-win64-lgpl-shared-8.1/bin/', import.meta.url));
const nextKey = key => (Math.imul(key, 0x5d588b65) + 1) >>> 0;

function movieKeys(data) {
  requireThat(Buffer.isBuffer(data) && data.length >= HEADER_SIZE && data.length % 4 === 0, 'Invalid .000 movie size.');
  let state = data.readUInt32LE(0), sum = 0;
  for (let i = 1; i < HEADER_SIZE / 4; i++) {
    state = nextKey(state);
    let value = data.readUInt32LE(i * 4) ^ state;
    if (i === 2711 || i === 3920) value &= 0xffffff00;
    if (i === 2935 || i === 5496) value &= 0xff00ffff;
    sum = (sum + value) >>> 0;
  }
  requireThat(sum === 0, 'The .000 movie header checksum is invalid.');
  return Uint32Array.from({length: 1024}, () => state = nextKey(state));
}

/** Decode the reversible SH3 PC movie wrapper without changing MPEG bytes. */
export function decodeMovie(data) {
  const keys = movieKeys(data), output = Buffer.from(data.subarray(HEADER_SIZE));
  for (let offset = 0; offset < output.length; offset += 4) output.writeUInt32LE((output.readUInt32LE(offset) ^ keys[(offset / 4) & 1023]) >>> 0, offset);
  requireThat(output.length >= 12 && output.readUInt32BE(0) === 0x000001ba, 'Movie payload is not an MPEG program stream.');
  return output;
}

/** Reuse the source wrapper and encrypt a complete MPEG program stream. */
export function encodeMovie(mpeg, original) {
  const keys = movieKeys(original);
  requireThat(Buffer.isBuffer(mpeg) && mpeg.length >= 12 && mpeg.readUInt32BE(0) === 0x000001ba, 'Expected an MPEG program stream.');
  const output = Buffer.alloc(HEADER_SIZE + Math.ceil(mpeg.length / 4) * 4, 0xff);
  original.copy(output, 0, 0, HEADER_SIZE); mpeg.copy(output, HEADER_SIZE);
  for (let offset = HEADER_SIZE; offset < output.length; offset += 4) output.writeUInt32LE((output.readUInt32LE(offset) ^ keys[((offset - HEADER_SIZE) / 4) & 1023]) >>> 0, offset);
  requireThat(decodeMovie(output).subarray(0, mpeg.length).equals(mpeg), 'Movie encryption verification failed.');
  return output;
}

function runMedia(tool, args) {
  const executable = path.join(runtime, `${tool}.exe`);
  requireThat(fs.existsSync(executable), 'The optional FFmpeg runtime is missing. Run Install media.cmd in the application folder (or pnpm setup:media for a source checkout), then restart.');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {stdout += chunk;});
    child.stderr.on('data', chunk => {stderr = (stderr + chunk).slice(-16000);});
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${tool} failed: ${stderr.trim() || `exit ${code}`}`)));
  });
}

function removeTemporary(folder) {
  const root = path.resolve(os.tmpdir()), target = path.resolve(folder);
  requireThat(target.startsWith(root + path.sep) && /^sh3tools-(movie|audio|adx)-/.test(path.basename(target)), 'Temporary media path escaped its root.');
  fs.rmSync(target, {recursive: true, force: true});
}

async function temporaryMovie(data, fn) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3tools-movie-'));
  try {const source = path.join(folder, 'source.mpg'); fs.writeFileSync(source, decodeMovie(data)); return await fn(source, folder);}
  finally {removeTemporary(folder);}
}

export async function probeMedia(file, countFrames = false) {
  const args = ['-v', 'error', '-show_format', '-show_streams', '-of', 'json'];
  if (countFrames) args.push('-count_frames');
  args.push(file);
  return JSON.parse(await runMedia('ffprobe', args));
}

const rate = value => {const [a, b = 1] = String(value).split('/').map(Number); return a / b;};

function movieProfile(probe) {
  const video = probe.streams.filter(s => s.codec_type === 'video'), audio = probe.streams.filter(s => s.codec_type === 'audio');
  requireThat(probe.format.format_name === 'mpeg' && video.length === 1 && audio.length === 1 && probe.streams.length === 2, 'Expected one video and one audio stream in an MPEG program stream.');
  requireThat(video[0].codec_name === 'mpeg1video' && video[0].pix_fmt === 'yuv420p' && audio[0].codec_name === 'mp2', 'Only the original MPEG-1 video / MP2 movie profile is supported for replacement.');
  const v = video[0], a = audio[0], frameRate = v.avg_frame_rate, fps = rate(frameRate);
  requireThat(Number.isFinite(fps) && fps > 0 && fps <= 60, 'Invalid movie frame rate.');
  return {container: 'MPEG-PS', videoCodec: v.codec_name, audioCodec: a.codec_name, width: v.width, height: v.height, frameRate, fps,
    frames: Number(v.nb_read_frames) || null, audioFrames: Number(a.nb_read_frames) || null,
    duration: v.nb_read_frames && a.nb_read_frames ? Math.max(Number(v.nb_read_frames) / fps, Number(a.nb_read_frames) * 1152 / Number(a.sample_rate)) : Number(probe.format.duration), sampleRate: Number(a.sample_rate), channels: a.channels,
    audioBitrate: Number(a.bit_rate), bitrate: Number(probe.format.bit_rate), aspect: v.display_aspect_ratio, pixelFormat: v.pix_fmt};
}

/** Inspect the original encoded profile; counts actual frames for import checks. */
export async function probeMovie(data, countFrames = false) {
  return temporaryMovie(data, async file => movieProfile(await probeMedia(file, countFrames)));
}

/** Produce a Chromium-playable WebM cache without modifying the source asset. */
export async function createMoviePreview(data, cacheFolder) {
  cacheFolder = path.resolve(cacheFolder);
  fs.mkdirSync(cacheFolder, {recursive: true});
  const file = path.join(cacheFolder, `movie-${sha256(data)}.webm`), info = await probeMovie(data);
  if (!fs.existsSync(file)) await temporaryMovie(data, async source => {
    const temporary = `${file}.${randomUUID()}.partial.webm`;
    try {
      await runMedia('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', source, '-map', '0:v:0', '-map', '0:a:0',
        '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2500k', '-threads', '4', '-c:a', 'libopus', '-b:a', '128k', temporary]);
      const preview = await probeMedia(temporary);
      requireThat(preview.streams.some(s => s.codec_name === 'vp8') && preview.streams.some(s => s.codec_name === 'opus'), 'Invalid movie preview conversion.');
      fs.renameSync(temporary, file);
    } finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
  });
  return {file, info};
}

/** Export the original MPEG bytes, or a WebM copy usable by modern players. */
export async function exportMovie(data, file, format = 'mpeg') {
  requireThat(!fs.existsSync(file), 'Choose a new export filename.');
  if (format === 'mpeg') writeNew(file, decodeMovie(data));
  else if (format === 'webm') await temporaryMovie(data, async (_source, folder) => {
    const preview = await createMoviePreview(data, folder);
    fs.copyFileSync(preview.file, file, fs.constants.COPYFILE_EXCL);
  });
  else throw new Error('Unknown movie export format.');
  return {file, size: fs.statSync(file).size};
}

function verifyProfile(reference, actual) {
  for (const field of ['videoCodec', 'audioCodec', 'width', 'height', 'sampleRate', 'channels', 'pixelFormat', 'frames', 'audioFrames']) requireThat(actual[field] === reference[field], `Replacement movie ${field} differs from the source.`);
  requireThat(Math.abs(actual.fps - reference.fps) < 0.000001, 'Replacement movie frame rate differs from the source.');
  // Actual decoded frame counts determine timing; MPEG-PS duration estimates vary with packet timestamps.
}

/** Convert an edited video to the source profile and return verified native .000 bytes. */
export async function importMovie(original, file) {
  const decoded = decodeMovie(original), size = fs.statSync(file).size;
  if (size === decoded.length || size === original.length) {
    const input = fs.readFileSync(file);
    if (input.equals(decoded) || input.equals(original)) return Buffer.from(original);
  }
  return temporaryMovie(original, async (source, folder) => {
    const reference = movieProfile(await probeMedia(source, true)), incoming = await probeMedia(file);
    requireThat(incoming.streams.some(s => s.codec_type === 'video') && incoming.streams.some(s => s.codec_type === 'audio'), 'Choose an edited movie containing both video and audio.');
    const duration = Number(incoming.format.duration);
    requireThat(Number.isFinite(duration) && Math.abs(duration - reference.duration) <= 1 / reference.fps + 1152 / reference.sampleRate,
      `Keep the original movie duration (${reference.duration.toFixed(3)} seconds) so in-game timing remains aligned.`);
    requireThat(reference.frames > 0, 'Could not count original movie frames.');
    const output = path.join(folder, 'replacement.mpg'), video = path.join(folder, 'video.m1v'), audio = path.join(folder, 'audio.mp2');
    const videoRate = Math.max(1000000, Math.min(8000000, Math.round(reference.bitrate - reference.audioBitrate)));
    await runMedia('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', file, '-map', '0:v:0',
      '-vf', `scale=${reference.width}:${reference.height}:flags=lanczos,setsar=1,fps=${reference.frameRate},tpad=stop_mode=clone:stop_duration=1`,
      '-frames:v', String(reference.frames), '-c:v', 'mpeg1video', '-pix_fmt', 'yuv420p', '-b:v', String(videoRate), '-maxrate', '8000000', '-bufsize', '1835008', '-g', '15', '-bf', '2', '-an', '-f', 'mpeg1video', video,
      '-map', '0:a:0', '-vn', '-c:a', 'mp2', '-ar', String(reference.sampleRate), '-ac', String(reference.channels), '-b:a', String(reference.audioBitrate),
      '-af', `apad,atrim=end_sample=${reference.audioFrames * 1152}`, '-t', String(reference.audioFrames * 1152 / reference.sampleRate), '-f', 'mp2', audio]);
    await runMedia('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-f', 'mpeg', output]);
    const mpeg = fs.readFileSync(output);
    if (mpeg.readUInt32BE(mpeg.length - 4) !== 0x000001b9) fs.appendFileSync(output, Buffer.from([0, 0, 1, 0xb9]));
    const verified = movieProfile(await probeMedia(output, true)); verifyProfile(reference, verified);
    await runMedia('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', output, '-f', 'null', '-']);
    return encodeMovie(fs.readFileSync(output), original);
  });
}
export async function convertAudioPcm(file, sampleRate, channels) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3tools-audio-'));
  try {
    const output = path.join(folder, 'audio.pcm');
    await runMedia('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', file, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-ar', String(sampleRate), '-ac', String(channels), '-f', 's16le', output]);
    requireThat(fs.statSync(output).size <= MAX_ASSET, 'Converted audio exceeds the 256 MiB editing limit.');
    return fs.readFileSync(output);
  } finally {removeTemporary(folder);}
}

export async function encodeAdxPcm(pcm, sampleRate, channels) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3tools-adx-'));
  try {
    const source = path.join(folder, 'audio.pcm'), output = path.join(folder, 'audio.adx'); fs.writeFileSync(source, pcm);
    await runMedia('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels), '-i', source, '-c:a', 'adpcm_adx', '-f', 'adx', output]);
    return fs.readFileSync(output);
  } finally {removeTemporary(folder);}
}
