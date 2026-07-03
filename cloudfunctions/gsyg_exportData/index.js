// 云函数 gsyg_exportData —— 管理员导出三张表全量为 JSON，写云存储，返回下载链接
// 认证：调用者的 gsyg_teachers 记录 isAdmin=true。非管理员 return { ok:false, error:'forbidden' }
// event（可选）:
//   collections: ["teachers","sessions","interviews"]  不传则三张全导
//   since: 时间戳 ms  只导 updatedAt >= since 的增量（默认全量）
// 返回：{ ok, fileID, downloadURL, expireAt, count:{teachers,sessions,interviews} }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLL = {
  teachers: 'gsyg_teachers',
  sessions: 'gsyg_sessions',
  interviews: 'gsyg_interviews'
};

const PAGE = 100; // 微信云数据库单次 get 上限

async function isAdmin(openid) {
  if (!openid) return false;
  const r = await db.collection(COLL.teachers).where({ openid: openid }).limit(1).get();
  return !!(r.data && r.data[0] && r.data[0].isAdmin);
}

async function fetchAll(collName, since) {
  const out = [];
  const where = since ? { updatedAt: _.gte(Number(since)) } : {};
  let skip = 0;
  // 循环拉，直到不足一页
  // 注：大表建议叠加 orderBy+_id 分页，这里用 skip/limit 简单实现；万级以内没问题
  // 上限 100 页（=1w 条）作保护
  for (let i = 0; i < 100; i++) {
    const r = await db.collection(collName).where(where).skip(skip).limit(PAGE).get();
    const arr = (r && r.data) || [];
    out.push.apply(out, arr);
    if (arr.length < PAGE) break;
    skip += PAGE;
  }
  return out;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function stamp() {
  // 云函数无时区问题，用 UTC+8 手工偏
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + '-' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds());
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  // 认证
  if (!(await isAdmin(OPENID))) {
    return { ok: false, error: 'forbidden', hint: '当前 openid 不在管理员列表；请在云开发控制台把该 teacher 记录 isAdmin 改为 true' };
  }

  const which = Array.isArray(event.collections) && event.collections.length ? event.collections : ['teachers', 'sessions', 'interviews'];
  const since = event.since ? Number(event.since) : null;

  try {
    const bundle = { exportedAt: Date.now(), since: since, operator: OPENID, data: {} };
    const count = {};
    for (const k of which) {
      if (!COLL[k]) continue;
      const rows = await fetchAll(COLL[k], since);
      bundle.data[k] = rows;
      count[k] = rows.length;
    }

    // 写云存储
    const cloudPath = 'gsyg-exports/' + stamp() + (since ? '-since' + since : '-full') + '.json';
    const buf = Buffer.from(JSON.stringify(bundle));
    const up = await cloud.uploadFile({ cloudPath: cloudPath, fileContent: buf });
    const fileID = up.fileID;

    // 拿下载 URL（有效期由平台决定，通常 2 小时）
    const url = await cloud.getTempFileURL({ fileList: [fileID] });
    const first = url && url.fileList && url.fileList[0];
    const downloadURL = (first && first.tempFileURL) || '';

    return {
      ok: true,
      fileID: fileID,
      downloadURL: downloadURL,
      cloudPath: cloudPath,
      bytes: buf.length,
      count: count,
      expireAt: Date.now() + 2 * 3600 * 1000, // 名义 2 小时，具体以 downloadURL 为准
      exportedAt: bundle.exportedAt
    };
  } catch (e) {
    return { ok: false, error: (e && (e.errMsg || e.message)) || 'export_failed' };
  }
};
