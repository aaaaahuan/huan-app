import type { StudyLesson } from '@shared/contracts/english-study';

export const lessons: (StudyLesson & { title: string; source: string })[] = [
  { title: '让步 · 工作与生活', source: '尽管这份工作比我预想的更有挑战性，但同事们给予的支持让我逐渐适应了新的环境。',
    reference: 'Although this job is more challenging than I expected, the support my colleagues have given me has helped me gradually adapt to the new environment.',
    explanation: 'Although 引导让步从句；more challenging than I expected 表示“比预想更有挑战性”。the support 后省略了关系代词 that；has helped me adapt 对应“让我适应”。although 不与 but 连用。' },
  { title: '条件 · 做出决定', source: '如果我们能在做决定之前充分考虑用户的实际需求，就能避免很多本来不必出现的问题。',
    reference: 'If we fully consider users’ actual needs before making a decision, we can avoid many problems that would otherwise arise.',
    explanation: 'If 引导条件从句，before making a decision 用动名词。that would otherwise arise 表示“否则会出现的”，也可译成 many unnecessary problems。' },
  { title: '原因 · 学习方法', source: '我之所以每天花半小时练习英语，并不是因为考试，而是因为我希望能够更自信地表达自己的想法。',
    reference: 'I spend half an hour practicing English every day not because of an exam, but because I want to express my ideas more confidently.',
    explanation: 'spend time doing something 表示花时间做某事；not because ... but because ... 连接两个原因。because of 后接名词，because 后接完整句子。' },
  { title: '定语从句 · 产品体验', source: '那些愿意认真倾听用户反馈并不断改进产品的团队，往往更容易赢得用户的长期信任。',
    reference: 'Teams that are willing to listen carefully to user feedback and continuously improve their products are often more likely to earn users’ long-term trust.',
    explanation: 'that 引导定语从句修饰 Teams；listen to 和 improve 由 and 并列。be more likely to do 表示“更容易／更可能做”。feedback 通常不可数。' },
  { title: '时间 · 持续行动', source: '直到真正开始独立负责这个项目，我才意识到，清晰的沟通和合理的时间安排与技术能力同样重要。',
    reference: 'It was not until I started managing this project independently that I realized clear communication and sensible time management were just as important as technical skills.',
    explanation: 'It was not until ... that ... 强调“直到……才……”。也可用 I did not realize ... until ...。just as important as 表示“同样重要”。' },
  { title: '转折 · 长期成长', source: '与其等待一个完美的机会，不如先从一件自己能够坚持的小事做起，因为真正的进步往往来自长期的积累。',
    reference: 'Rather than wait for the perfect opportunity, it is better to start with something small that you can stick with, because real progress often comes from consistent effort over time.',
    explanation: 'Rather than 表示“与其”；something small 中形容词放在不定代词之后。stick with 表示“坚持”。长期积累可以自然译为 consistent effort over time，不必逐字翻译。' }
];
