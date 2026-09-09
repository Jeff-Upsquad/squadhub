export type Task = {
  id: string;
  title: string;
  list: string;
  space: string;
  due: 'Today' | 'Tomorrow' | 'Overdue' | 'Sep 11' | 'Sep 14';
  priority: 'High' | 'Medium' | 'Low';
  assignee: string;
  focus: boolean;
  isNew: boolean;
  done: boolean;
  description?: string;
};

const entries: [string, string, Task['due'], Task['priority'], string][] = [
  ['Payroll calculation — employees', 'Client operations', 'Today', 'High', 'J'],
  ['Review September deliverables', 'Client operations', 'Tomorrow', 'Medium', 'SK'],
  ['Accountant subscription — make it live', 'My Tasks', 'Today', 'High', 'J'],
  ['Designers Squadbook', 'My Tasks', 'Today', 'Medium', 'J'],
  ['Video Editors Squadbook', 'My Tasks', 'Tomorrow', 'Medium', 'AM'],
  ['Customers Squadbooks', 'My Tasks', 'Sep 11', 'Low', 'J'],
  ['Create the master course curriculum', 'SquadHire', 'Tomorrow', 'Medium', 'SK'],
  ['Cashfree payment gateway integration', 'Squadbooks', 'Overdue', 'High', 'AM'],
  ['Move BigRev books to Squadbooks', 'Accounts Work', 'Sep 11', 'Low', 'J'],
  ['Recording tasks — recruiter training', 'Recording Tasks', 'Tomorrow', 'Medium', 'J'],
  ['Move DVAR books to Squadbooks', 'Accounts Work', 'Sep 14', 'Low', 'J'],
  ['Finalize the September content plan', 'Sales & Marketing', 'Overdue', 'High', 'SK'],
  ['Review new candidate applications', 'SquadHire', 'Today', 'High', 'J'],
  ['Update the sales onboarding guide', 'Sales Team Tasks', 'Tomorrow', 'Medium', 'SK'],
  ['Prepare the weekly team report', 'My Tasks', 'Tomorrow', 'Low', 'AM'],
  ['Review website wireframes', 'Dev Tasks', 'Sep 11', 'Medium', 'J'],
  ['QA the partner onboarding flow', 'Dev Tasks', 'Sep 11', 'High', 'AM'],
  ['Collect customer feedback', 'Client operations', 'Sep 14', 'Low', 'SK'],
  ['Document the payment workflow', 'Squadbooks', 'Sep 14', 'Medium', 'J'],
  ['Schedule the product walkthrough', 'My Tasks', 'Sep 14', 'Low', 'J'],
  ['Organize the design library', 'My Tasks', 'Sep 11', 'Low', 'AM'],
  ['Review the partner resource kit', 'SquadHire', 'Sep 14', 'Medium', 'J'],
  ['Draft next week’s newsletter', 'Sales & Marketing', 'Sep 14', 'Medium', 'SK'],
  ['Update the course welcome video', 'Recording Tasks', 'Sep 14', 'Low', 'J'],
  ['Reconcile August accounts', 'Accounts Work', 'Sep 11', 'Medium', 'J'],
  ['Prepare team meeting notes', 'My Tasks', 'Sep 11', 'Low', 'AM'],
  ['Complete the daily check-in', 'My Tasks', 'Today', 'Low', 'J'],
  ['Share the weekly team priorities', 'My Tasks', 'Today', 'Medium', 'J'],
];

export const INITIAL_TASKS: Task[] = entries.map(([title, list, due, priority, assignee], i) => ({
  id: `preview-${i + 1}`, title, list, due, priority, assignee,
  space: list === 'Client operations' ? 'Client spaces' : "Jeff’s space",
  focus: i < 12, isNew: i >= 12 && i < 22, done: i >= 26,
}));

export const FAVORITES = ['Sales Team Tasks', 'untangle', 'Sales Hiring | upsquad', 'Recording Tasks', 'Squadbooks', 'Sales Workflow + Training', 'SquadPayroll', 'Recruiter training'];
