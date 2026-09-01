'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function decodeEnvValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function parseEnvText(text) {
  const values = {};
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = decodeEnvValue(match[2]);
  }
  return values;
}

function encodeEnvValue(value) {
  const text = String(value);
  if (/[\r\n\u0000]/.test(text)) throw new TypeError('environment values must not contain line breaks or NUL bytes');
  if (!text || /^[A-Za-z0-9_./:+@=-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function restrictFilePermissions(filePath) {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o600);
    return;
  }

  const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true
  });
  const sid = identity.status === 0 && String(identity.stdout || '').match(/\bS-1-\d+(?:-\d+)+\b/i);
  if (!sid) throw new Error('unable to determine the current Windows security identifier');

  const acl = spawnSync('icacls.exe', [
    filePath,
    '/inheritance:r',
    '/grant:r',
    `*${sid[0]}:(F)`,
    '*S-1-5-18:(F)',
    '*S-1-5-32-544:(F)'
  ], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (acl.status !== 0) throw new Error('unable to restrict local environment file permissions');
}

/** 读取本机 .env；只补充尚未存在的进程变量，绝不输出密钥内容。 */
function loadEnvFile(filePath, target = process.env) {
  if (!fs.existsSync(filePath)) return { loaded: false, keys: [] };
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError('environment file must be a regular file');
  // Old configuration scripts may have created a broadly inherited ACL.
  // Tighten it on every startup before reading any stored secret.
  restrictFilePermissions(filePath);
  const values = parseEnvText(fs.readFileSync(filePath, 'utf8'));
  const keys = [];
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === undefined || target[key] === '') {
      target[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, keys };
}

/**
 * Atomically update selected values in a local .env file. Values are never
 * returned, and the temporary/final file is restricted to the current user
 * wherever the host operating system supports POSIX-style modes.
 */
function updateEnvFile(filePath, updates) {
  if (!filePath) throw new TypeError('filePath is required');
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new TypeError('updates must be an object');
  const entries = Object.entries(updates);
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new TypeError('environment variable name is invalid');
    if (typeof value !== 'string') throw new TypeError('environment variable values must be strings');
    encodeEnvValue(value);
  }

  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  let original = '';
  if (fs.existsSync(filePath)) {
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError('environment file must be a regular file');
    original = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  }
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingEol = /(?:\r\n|\n)$/.test(original);
  const lines = original ? original.split(/\r?\n/) : [];
  if (hadTrailingEol && lines[lines.length - 1] === '') lines.pop();

  const replacements = new Map(entries);
  const written = new Set();
  const nextLines = [];
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = match && match[1];
    if (!key || !replacements.has(key)) {
      nextLines.push(line);
      continue;
    }
    if (!written.has(key)) nextLines.push(`${key}=${encodeEnvValue(replacements.get(key))}`);
    written.add(key);
  }
  for (const [key, value] of entries) {
    if (!written.has(key)) nextLines.push(`${key}=${encodeEnvValue(value)}`);
  }

  const output = `${nextLines.join(eol)}${eol}`;
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, output, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    restrictFilePermissions(temporary);
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return { updated: entries.map(([key]) => key) };
}

module.exports = { loadEnvFile, updateEnvFile, parseEnvText, encodeEnvValue, restrictFilePermissions };
