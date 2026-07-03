// 云函数 gsyg_initDb —— 一次性初始化数据库
// 1) 幂等创建 3 个集合：gsyg_teachers / gsyg_sessions / gsyg_interviews
// 2) 按查询模式创建索引（含唯一索引）
// 调用方式：微信开发者工具「云开发 → 云函数 → gsyg_initDb → 云端测试」，event 可空
//
// 建索引需要 TCB API 密钥（wx-server-sdk 不支持建索引）。在本云函数的
// 「配置 → 环境变量」中设置：TCB_SECRET_ID / TCB_SECRET_KEY / TCB_ENV
// 未配置时 indexes 步骤会跳过，并在返回里给出需要手动建立的索引清单。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 集合名与 miniprogram/utils/config.js 的 COLLECTIONS 保持一致
const COLL = {
  teachers: 'gsyg_teachers',
  sessions: 'gsyg_sessions',
  interviews: 'gsyg_interviews'
};

// 索引方案：按各集合的实际查询语义
//   teachers 按 openid upsert       → openid 唯一
//   sessions 按 sessionId upsert    → sessionId 唯一；openid+createdAt 复合，用于用户历史列表
//   interviews 按 sessionId upsert  → sessionId 唯一；openid 单列，用于按用户聚合
const INDEX_PLAN = {
  [COLL.teachers]: [
    { name: 'uniq_openid', keys: [{ name: 'openid', direction: 1 }], unique: true },
    { name: 'idx_updatedAt', keys: [{ name: 'updatedAt', direction: -1 }], unique: false }
  ],
  [COLL.sessions]: [
    { name: 'uniq_sessionId', keys: [{ name: 'sessionId', direction: 1 }], unique: true },
    {
      name: 'idx_openid_createdAt',
      keys: [{ name: 'openid', direction: 1 }, { name: 'createdAt', direction: -1 }],
      unique: false
    },
    { name: 'idx_submitStatus', keys: [{ name: 'submitStatus', direction: 1 }], unique: false }
  ],
  [COLL.interviews]: [
    { name: 'uniq_sessionId', keys: [{ name: 'sessionId', direction: 1 }], unique: true },
    { name: 'idx_openid', keys: [{ name: 'openid', direction: 1 }], unique: false }
  ]
};

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
    return { collection: name, action: 'created' };
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || '';
    // 云开发不同接口/版本的集合已存在错误码不一致，统一视为幂等成功。
    if (
      /already exist|resourceexist|table exist|collection.*exist/i.test(msg) ||
      (e && (e.errCode === -501001 || e.errCode === -502005 || e.errCode === 500011))
    ) {
      return { collection: name, action: 'exists' };
    }
    return { collection: name, action: 'error', error: msg };
  }
}

function getManagerApp() {
  const secretId = process.env.TCB_SECRET_ID;
  const secretKey = process.env.TCB_SECRET_KEY;
  const envId = process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV;

  if (!secretId || !secretKey) {
    return {
      skipped: true,
      reason: '未配置 TCB_SECRET_ID / TCB_SECRET_KEY 环境变量，已跳过建索引。'
    };
  }

  const CloudBase = require('@cloudbase/manager-node');
  return {
    app: CloudBase.init({ secretId, secretKey, envId }),
    envId
  };
}

function toManagerIndex(spec) {
  return {
    IndexName: spec.name,
    MgoKeySchema: {
      MgoIsUnique: !!spec.unique,
      MgoIndexKeys: spec.keys.map((k) => ({
        Name: k.name,
        Direction: String(k.direction)
      }))
    }
  };
}

async function createIndexWithManager(app, collName, spec) {
  await app.database.updateCollection(collName, {
    CreateIndexes: [toManagerIndex(spec)]
  });
  return { ok: true, note: spec.unique ? 'created(unique)' : 'created' };
}

async function ensureIndexes(collName, manager) {
  const specs = INDEX_PLAN[collName] || [];
  const out = [];

  if (manager.skipped) {
    return specs.map((spec) => ({
      index: spec.name,
      unique: !!spec.unique,
      keys: spec.keys,
      ok: false,
      skipped: true,
      error: manager.reason
    }));
  }

  for (const spec of specs) {
    try {
      const r = await createIndexWithManager(manager.app, collName, spec);
      out.push({ index: spec.name, unique: !!spec.unique, keys: spec.keys, ...r });
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || String(e);
      if (/exist|already|duplicate/i.test(msg)) {
        out.push({ index: spec.name, unique: !!spec.unique, keys: spec.keys, ok: true, note: 'already_exists' });
      } else {
        out.push({ index: spec.name, unique: !!spec.unique, keys: spec.keys, ok: false, error: msg });
      }
    }
  }
  return out;
}

exports.main = async (event = {}) => {
  const action = event.action || 'all';
  const collReport = [];
  const indexReport = {};

  if (action === 'all' || action === 'collections') {
    for (const name of Object.values(COLL)) {
      collReport.push(await ensureCollection(name));
    }
  }

  if (action === 'all' || action === 'indexes') {
    const manager = getManagerApp();
    for (const name of Object.values(COLL)) {
      indexReport[name] = await ensureIndexes(name, manager);
    }
  }

  // 汇总
  const allIndexOk = Object.values(indexReport).flat().every((r) => r.ok);
  return {
    ok: true,
    action,
    env: cloud.DYNAMIC_CURRENT_ENV,
    tcbEnv: process.env.TCB_ENV || '',
    collections: collReport,
    indexes: indexReport,
    manualNote: action === 'collections'
      ? '集合已处理，未执行索引步骤。'
      : (allIndexOk
        ? '所有集合与索引已就绪。'
        : '部分索引未能自动建立。请确认 gsyg_initDb 云函数环境变量 TCB_SECRET_ID / TCB_SECRET_KEY / TCB_ENV 已配置，或到「云开发 → 数据库 → 集合 → 索引管理」按 plan 手工添加。'),
    plan: INDEX_PLAN
  };
};
