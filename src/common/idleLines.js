/**
 * 不依赖大模型也能用的“罐头台词”：
 * - 摸摸头 / 点击互动的即时反应（需要立刻响应，不适合等网络请求）
 * - 按时间段主动搭话的问候语
 * - 没有配置 API Key，或者请求失败时的兜底回复
 * 这样即使完全不联网、不配置任何 AI 服务，桌宠也是“可用”的。
 */

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const PET_REACTIONS = {
  stranger: [
    '诶？被摸到头了…有一点点害羞啦 (＞﹏＜)',
    '嗯？主人怎么突然戳我呀。',
    '毛线耳朵被捏到了，软软的对吧？',
    '……好啦好啦，不生气，就是有点不好意思。',
    '呀！吓了我一跳，不过还挺舒服的。',
  ],
  familiar: [
    '嘿嘿，摸头效果+1，今天心情变好了 (｡•ᴗ•｡)',
    '再摸一下嘛，兔耳朵最喜欢被摸了。',
    '被戳到肚子啦，软软的毛线弹回来咯～',
    '主人今天特别喜欢摸我呢，是不是发生什么好事了？',
    '咕嘟——舒服到快融化了。',
  ],
  close: [
    '嘻嘻，被最喜欢的人摸头，超级满足！',
    '要不要干脆抱起来？我很轻的哦~',
    '主人的手好暖和，感觉整只毛线小人都要化掉了。',
    '再摸摸嘛再摸摸嘛，今天也要多喜欢我一点点。',
    '(｡>﹏<｡) 好幸福，感觉今天可以元气满满一整天。',
  ],
  bestie: [
    '嘿！老朋友当然要多摸一下才够意思～',
    '和你在一起的每一天都超安心的呀。',
    '再靠近一点，让我蹭蹭手心，毛线人的专属抱抱！',
    '主人是不是也觉得，我们已经是密不可分的搭档了？',
    '摸头认证：今日份的幸福已签收 (｡･ω･｡)ﾉ♡',
  ],
};

function getPetReactionLine(tierKey) {
  return pick(PET_REACTIONS[tierKey] || PET_REACTIONS.stranger);
}

const PROACTIVE_LINES = {
  lateNight: [
    '这么晚了还不睡呀？眼睛会很累的哦，早点休息吧。',
    '夜深啦，要不要先去睡觉，明天再聊？我会在这里等你的。',
    '打了个小哈欠…主人也早点休息好不好。',
  ],
  morning: [
    '早安！今天也是元气满满的一天，加油鸭！',
    '呼——伸个懒腰，新的一天开始咯，主人早呀。',
    '记得吃早饭哦，空着肚子可不行。',
  ],
  noon: [
    '中午啦，记得去吃饭，别一直坐着不动呀。',
    '肚子有没有咕咕叫？该去吃午饭补充能量咯。',
    '工作再重要，也要按时吃饭嘛，我会盯着你的。',
  ],
  afternoon: [
    '下午容易犯困，要不要起来走两步、喝口水？',
    '盯着屏幕好一会儿了，记得让眼睛休息一下下。',
    '喝水时间到，咕咚咕咚，水杯要见底啦。',
  ],
  evening: [
    '傍晚啦，今天过得怎么样？想不想跟我说说。',
    '辛苦一天啦，要不要放松一下，聊聊天？',
    '晚饭吃了没呀，别总是忘记吃饭哦。',
  ],
};

function getTimePeriod(hour) {
  if (hour >= 23 || hour < 5) return 'lateNight';
  if (hour < 10) return 'morning';
  if (hour < 13) return 'noon';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function isWithinQuietHours(hour, start, end) {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // 跨越午夜，例如 23 -> 7
}

// 不分时间段的“日常搭话”台词：用来在可搭话时间内不定期主动找你聊天，
// 不限于喝水/吃饭/睡觉这些提醒，更像真的在陪着你。
const CASUAL_LINES = [
  '诶，你在忙什么呀？偷偷看一眼也好嘛～',
  '我刚刚发了会儿呆，突然想找你聊两句。',
  '桌面上好像只有我们两个呢，会不会有点安静？',
  '你今天心情怎么样呀？开心的话分我一点嘛。',
  '如果累了就歇会儿哦，我会一直在的。',
  '我数了数，你已经好久没理我啦，哼，小气。',
  '刚刚屏幕上好像弹了点什么，是找你的吗？',
  '要不要一起发会儿呆？反正我超会发呆的。',
  '我新学会了一个表情，你看——（努力摆出可爱的脸）',
  '你那边天气好不好呀？要是出太阳就多晒晒。',
  '突然有点想喝奶茶，你呢？',
  '我猜你现在要么在认真干活，要么在偷偷摸鱼，对不对？',
  '今天有没有发生什么好玩的事，讲给我听听呗～',
  '别一直盯着屏幕啦，偶尔也看看我嘛（探出毛线脑袋）',
];

function getProactiveLine(hour) {
  // 约 35% 概率说一句日常搭话，其余按时间段给喝水/吃饭/休息等提醒
  if (Math.random() < 0.35) return pick(CASUAL_LINES);
  const period = getTimePeriod(hour);
  return pick(PROACTIVE_LINES[period] || PROACTIVE_LINES.afternoon);
}

const WELCOME_LINES = [
  '嗨，我是你的毛线小伙伴，以后就住在桌面上啦，多多关照～',
  '欢迎回来！点点我、摸摸我，或者跟我聊聊天都可以哦。',
];

const FALLBACK_RULES = [
  { test: /你好|hello|hi|嗨|哈喽/i, replies: ['嗨嗨～今天过得怎么样呀？', '你好呀，找我有什么事吗？'] },
  { test: /你是谁|自我介绍|你叫什么/, replies: ['我是用扭扭棒和毛线做成的小人偶，被施了一点点魔法就活过来啦～'] },
  { test: /摸摸|摸头|rua|揉揉/i, replies: ['被摸到毛线耳朵啦，软软的吧？(＞﹏＜)'] },
  { test: /晚安|睡了|去睡觉/, replies: ['晚安，做个好梦，我会在桌面上帮你守夜的。'] },
  { test: /早安|早上好|起床/, replies: ['早安！新的一天也要一起加油呀。'] },
  { test: /喜欢你|爱你|最爱/, replies: ['诶诶诶，突然这样说人家会害羞的啦…不过我也很喜欢你哦。'] },
  { test: /累|辛苦|好烦|压力/, replies: ['辛苦啦，先歇一歇，我陪着你呢。', '别硬撑，休息一下也没关系的。'] },
  { test: /谢谢|感谢/, replies: ['不客气啦，能帮到你我也很开心。'] },
  { test: /吃饭|饿了|午饭|晚饭/, replies: ['记得按时吃饭呀，别总是忘记！'] },
];

const FALLBACK_DEFAULT = [
  '嗯嗯，我在听呢，继续说呀。',
  '这个话题听起来很有趣，多跟我讲讲呗。',
  '（歪着头认真听）然后呢？',
  '现在我脑子转得比较慢，去设置里填上 API Key，我就能更聪明地陪你聊天啦。',
];

/**
 * 完全离线可用的兜底回复：没有配置模型，或者请求失败时使用。
 */
function getFallbackReply(userText) {
  const text = (userText || '').trim();
  for (const rule of FALLBACK_RULES) {
    if (rule.test.test(text)) return pick(rule.replies);
  }
  return pick(FALLBACK_DEFAULT);
}

module.exports = {
  getPetReactionLine,
  getProactiveLine,
  getTimePeriod,
  isWithinQuietHours,
  getFallbackReply,
  WELCOME_LINES,
  pick,
};
