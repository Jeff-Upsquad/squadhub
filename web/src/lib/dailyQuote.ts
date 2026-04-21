const QUOTES: string[] = [
  'Small daily steps compound into something big.',
  'Ship the draft. Polish later.',
  'The hard part is starting. You already did that.',
  'Make today slightly better than yesterday.',
  'Progress hides in the work nobody sees.',
  'A focused hour beats a scattered day.',
  'Do the next right thing, then the next.',
  'Quiet work speaks the loudest.',
  'Tighten the loop. Ship. Learn. Repeat.',
  'Clarity comes from action, not thought.',
  'The best time to fix it is now.',
  'You are closer than you think.',
  'One honest conversation unblocks a week.',
  'Keep the promise you made to yourself.',
  'Done beats perfect, every time.',
  'Today you get to choose again.',
  'Write the email. Send the message. Start.',
  'Trade a thousand wishes for one small start.',
  'Momentum is a muscle. Use it.',
  'Find the smallest step and take it.',
  'Less noise. More signal.',
  'Your future self is already proud.',
  'Do the work. Trust the process.',
  'Build something a little kinder today.',
  'The details you notice make the difference.',
  'Simple is an achievement.',
  'Ship the thing you have been avoiding.',
  'Consistency outlasts intensity.',
  'Give yourself permission to begin again.',
  'You are allowed to take the day one hour at a time.',
];

export function getDailyQuote(d: Date = new Date()): string {
  const start = new Date(d.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((d.getTime() - start.getTime()) / 86_400_000);
  return QUOTES[dayOfYear % QUOTES.length] as string;
}
