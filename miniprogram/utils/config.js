/**
 * 全局配置常量。抽出来便于替换（如更换云环境、集合名、前缀）。
 */

// 微信云开发（CloudBase）云环境 ID。更换环境只改这里。
const CLOUD_ENV = 'cloud1-2gefzeri3cb333f2';

// 统一业务前缀（与知识库题号 GSYG_ 一致）。想换前缀集中改这里 + README 标注。
const PREFIX = 'gsyg_';

// 三个云数据库集合名（gsyg_ 前缀）
const COLLECTIONS = {
  teachers: PREFIX + 'teachers', // gsyg_teachers
  sessions: PREFIX + 'sessions', // gsyg_sessions
  interviews: PREFIX + 'interviews' // gsyg_interviews
};

// 三个云函数名（gsyg_ 前缀）；云函数内部读写云数据库，客户端不直写 DB
const CLOUD_FUNCTIONS = {
  reportTeacher: PREFIX + 'reportTeacher', // gsyg_reportTeacher
  reportSession: PREFIX + 'reportSession', // gsyg_reportSession
  reportInterview: PREFIX + 'reportInterview', // gsyg_reportInterview
  interviewChat: PREFIX + 'interviewChat' // gsyg_interviewChat（AI 动态追问）
};

module.exports = { CLOUD_ENV, PREFIX, COLLECTIONS, CLOUD_FUNCTIONS };
