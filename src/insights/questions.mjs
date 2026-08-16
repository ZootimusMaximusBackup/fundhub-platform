// Question banks for the three collections:
// start = existing apply survey, mid = phone/AI check-in, post = Google Meet interview.
// Staff ask mid/post on a call. Ids stay stable.

export const MID_QUESTIONS = [
  { id: "hardest_now", prompt: "What is the hardest part of this process for you right now?" },
  { id: "working_looks_like", prompt: "What would \"this is working\" look like for you in the next 30 days?" },
  { id: "in_the_way", prompt: "What is getting in your way?" },
  { id: "wish_told_sooner", prompt: "What do you wish someone had told you at the start?" }
];

export const POST_QUESTIONS = [
  { id: "life_before", prompt: "What was going on in your life or business when you first reached out?" },
  { id: "already_tried", prompt: "What had you already tried that did not work?" },
  { id: "almost_stopped", prompt: "What almost stopped you from moving forward with us?" },
  { id: "changed_first", prompt: "After you got funded, what changed first?" },
  { id: "tell_someone", prompt: "What would you tell someone who is in the same spot you were in?" },
  { id: "do_well_better", prompt: "What did we do well? What should we do better?" },
  { id: "felt_funded", prompt: "How did you feel the day you got funded?" }
];

export const QUESTIONS = {
  mid: MID_QUESTIONS,
  post: POST_QUESTIONS
};

export function formatQuestionList(stage) {
  const list = QUESTIONS[stage] || [];
  return list.map((q, i) => `${i + 1}. ${q.prompt}`).join("\n");
}
