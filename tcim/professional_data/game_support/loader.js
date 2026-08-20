'use strict';

/**
 * 加载 tcim/professional_data/game_support 的题目数据包为内存对象。
 * 供网页前端（web/src/core/tcim）与 Node 测试复用。
 * 模块只读取注入的数据，不访问文件系统。
 */

const fs = require('fs');
const path = require('path');

function loadGameSupportData(baseDir) {
  const base = baseDir || path.join(__dirname);
  const registry = JSON.parse(fs.readFileSync(path.join(base, 'common', 'item_registry.json'), 'utf8'));
  const items = {};
  for (const item of registry.items) {
    const qid = item.item_id;
    const dir = path.join(base, 'questions', `q${String(parseInt(qid.slice(1), 10)).padStart(2, '0')}`);
    const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    items[qid] = {
      item_id: qid,
      title: item.title,
      ontology: read('ontology.json'),
      anchors: read('evidence_anchors.json'),
      priority: read('priority_rules.json'),
      probe: read('probe_rules.json'),
      stop: read('stop_rules.json'),
      metadata: read('metadata.json')
    };
  }
  return {
    version: registry.version,
    common: {
      ability_framework: JSON.parse(fs.readFileSync(path.join(base, 'common', 'ability_framework.json'), 'utf8')),
      item_capability_mapping: JSON.parse(fs.readFileSync(path.join(base, 'common', 'item_capability_mapping.json'), 'utf8')),
      empirical_scoring_rules: JSON.parse(fs.readFileSync(path.join(base, 'common', 'empirical_scoring_rules.json'), 'utf8'))
    },
    items
  };
}

module.exports = { loadGameSupportData };
