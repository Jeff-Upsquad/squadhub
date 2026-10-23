'use client';

import { useState } from 'react';
import Link from 'next/link';
import Icon, { type IconName } from './PreviewIcon';
import './landing.css';
import './asset.css';

type View = 'home' | 'tasks' | 'chat' | 'calendar';
const views: { id: View; label: string; icon: IconName }[] = [
  { id: 'home', label: 'My home', icon: 'home' },
  { id: 'tasks', label: 'Tasks & projects', icon: 'circleCheck' },
  { id: 'chat', label: 'Team chat', icon: 'chat' },
  { id: 'calendar', label: 'Day planner', icon: 'calendar' },
];
const tasks = [
  { title: 'Give the homepage its final polish', project: 'Website launch', initials: 'AM', time: 'Today' },
  { title: 'Share the campaign brief with the team', project: 'Marketing', initials: 'SK', time: 'Today' },
  { title: 'Review the new onboarding flow', project: 'Product', initials: 'JD', time: 'Tomorrow' },
  { title: 'Prepare notes for the client catch-up', project: 'Client work', initials: 'AM', time: 'Tomorrow' },
];

function Brand() {
  return <span className="sl-brand"><span className="sl-mark">SH<span /></span><span>SquadHub<span className="sl-brand-dot">.</span></span></span>;
}

function Avatar({ initials, dark = false }: { initials: string; dark?: boolean }) {
  return <span className={`sl-avatar ${dark ? 'sl-avatar-dark' : ''}`}>{initials}</span>;
}

function ChatMessages({ compact = false }: { compact?: boolean }) {
  return <div className={`sl-messages ${compact ? 'sl-messages-compact' : ''}`}>
    <div className="sl-message"><Avatar initials="AM" /><div><strong>Anjali <time>10:24</time></strong><p>The homepage is ready for a fresh pair of eyes. Who’s up for a quick review?</p><span className="sl-attachment"><Icon name="document" size={14} /> Homepage brief <Icon name="upRight" size={12} /></span></div></div>
    <div className="sl-message"><Avatar initials="SK" dark /><div><strong>Sanjay <time>10:26</time></strong><p>On it! I’ll leave my feedback on the task.</p><span className="sl-reaction"><Icon name="check" size={12} /> 2</span></div></div>
    {!compact && <div className="sl-message"><Avatar initials="JD" /><div><strong>Jordan <time>10:28</time></strong><p>I’ve added the launch checklist to our shared docs. Everything’s in one place.</p><span className="sl-attachment"><Icon name="circleCheck" size={14} /> Website launch checklist</span></div></div>}
  </div>;
}

function WorkspacePreview() {
  const [view, setView] = useState<View>('home');
  const [completed, setCompleted] = useState<number[]>([2]);
  const [chatDraft, setChatDraft] = useState('');
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState<'all' | 'open' | 'completed'>('all');
  const toggleTask = (i: number) => setCompleted(current => current.includes(i) ? current.filter(n => n !== i) : [...current, i]);
  return <div className="sl-preview-wrap" id="workspace">
    <div className="sl-demo-tabs" role="tablist" aria-label="Explore the SquadHub workspace">
      {views.map((item, index) => <button key={item.id} role="tab" id={`sl-tab-${item.id}`} aria-controls="sl-workspace-panel" aria-selected={view === item.id} tabIndex={view === item.id ? 0 : -1} onClick={() => setView(item.id)} onKeyDown={event => {
        const nextIndex = event.key === 'ArrowRight' ? (index + 1) % views.length : event.key === 'ArrowLeft' ? (index - 1 + views.length) % views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : null;
        if (nextIndex === null) return;
        event.preventDefault();
        setView(views[nextIndex].id);
        document.getElementById(`sl-tab-${views[nextIndex].id}`)?.focus();
      }}><Icon name={item.icon} size={17} />{item.label}</button>)}
    </div>
    <div className="sl-workspace" id="sl-workspace-panel" role="tabpanel" aria-labelledby={`sl-tab-${view}`}>
      <aside className="sl-rail" aria-label="Workspace views">
        <span className="sl-rail-logo">SH</span>
        {views.map(item => <button key={item.id} className={view === item.id ? 'is-active' : ''} aria-label={item.label} aria-pressed={view === item.id} onClick={() => setView(item.id)}><Icon name={item.icon} size={20} /></button>)}
        <span className="sl-rail-divider" /><span className="sl-rail-decoration"><Icon name="document" size={20} /></span><span className="sl-rail-decoration"><Icon name="clock" size={20} /></span>
        <span className="sl-rail-bottom"><Avatar initials="JD" /></span>
      </aside>
      <aside className="sl-sidebar">
        <div className="sl-team-name"><span className="sl-team-icon"><Icon name="layers" size={16} /></span> Our workspace <Icon name="down" size={13} /></div>
        <div className="sl-sidebar-label">WORKSPACE</div>
        {views.map(item => <button key={item.id} className={view === item.id ? 'is-active' : ''} onClick={() => setView(item.id)}><Icon name={item.icon} size={16} />{item.id === 'tasks' ? 'My tasks' : item.label}<span>{item.id === 'tasks' ? 4 - completed.length : item.id === 'chat' ? '2' : ''}</span></button>)}
        <div className="sl-sidebar-label">YOUR SPACES</div>
        <span className="sl-sidebar-item"><span className="sl-space-square" /> Website launch</span>
        <span className="sl-sidebar-item"><span className="sl-space-square sl-space-outline" /> Marketing</span>
        <span className="sl-sidebar-item"><span className="sl-space-square sl-space-gray" /> Product</span>
        <div className="sl-sidebar-label">CHANNELS</div>
        <button onClick={() => setView('chat')}><Icon name="hash" size={16} /> team-updates</button>
        <button onClick={() => setView('chat')}><Icon name="hash" size={16} /> website-launch</button>
        <div className="sl-sidebar-foot"><span className="sl-tiny-dot" /> A little more in sync.</div>
      </aside>
      <div className="sl-app-main">
        <div className="sl-app-topbar"><span>Workspace <Icon name="chevron" size={12} /> {views.find(item => item.id === view)?.label}</span><span className="sl-topbar-right"><Icon name="search" size={16} /><Icon name="bell" size={16} /><Avatar initials="JD" /></span></div>
        <div className="sl-app-content">
          <div className="sl-app-heading"><div><span className="sl-app-eyebrow">{view === 'home' ? 'A LITTLE CLARITY FOR YOUR DAY' : view === 'tasks' ? 'FROM TO-DO TO DONE' : view === 'chat' ? 'KEEP THE CONVERSATION CONNECTED' : 'MAKE ROOM FOR WHAT MATTERS'}</span><h3>{view === 'home' ? 'Good morning, Jordan' : view === 'tasks' ? 'Your work, in focus.' : view === 'chat' ? '# website-launch' : 'A day with a plan.'}<span>{view === 'home' ? ' ✳' : ''}</span></h3><p>{view === 'home' ? 'Here’s what’s happening in your corner of the squad.' : view === 'tasks' ? 'A clear next step. A shared finish line.' : view === 'chat' ? 'The people, decisions, and context behind the work.' : 'Your tasks and your time, side by side.'}</p></div><span className="sl-demo-date">MON, OCT 12</span></div>
          {(view === 'home' || view === 'tasks') && <>
            <div className="sl-stats"><div><span>YOUR FOCUS</span><b>{4 - completed.length}<small>tasks to move forward</small></b></div><div><span>MAKING PROGRESS</span><b>{completed.length.toString().padStart(2, '0')}<small>completed tasks</small></b></div><div><span>TIME WELL SPENT</span><b>02<span className="sl-stat-unit">h</span> 24<span className="sl-stat-unit">m</span><small>tracked today</small></b></div></div>
            <div className={`sl-app-grid ${view === 'tasks' ? 'sl-app-grid-full' : ''}`}><div className="sl-focus"><div className="sl-panel-heading"><b><Icon name="circleCheck" size={17} /> {view === 'tasks' ? 'All tasks' : 'Your focus list'}</b><span>{4 - completed.length} open</span></div>
              {view === 'tasks' && <div className="sl-task-filters">{(['all', 'open', 'completed'] as const).map(filter => <button key={filter} aria-pressed={taskFilter === filter} onClick={() => setTaskFilter(filter)}>{filter[0].toUpperCase() + filter.slice(1)}</button>)}</div>}
              {tasks.map((task, i) => (view !== 'tasks' || taskFilter === 'all' || (taskFilter === 'completed' ? completed.includes(i) : !completed.includes(i))) && <div className={`sl-task ${completed.includes(i) ? 'sl-task-done' : ''}`} key={task.title}><button className="sl-task-check" aria-label={`${completed.includes(i) ? 'Reopen' : 'Complete'} ${task.title}`} aria-pressed={completed.includes(i)} onClick={() => toggleTask(i)}>{completed.includes(i) && <Icon name="check" size={12} />}</button><div><b>{task.title}</b><span>{task.project}</span></div><Avatar initials={task.initials} /><time>{task.time}</time></div>)}
              <div className="sl-focus-footer"><Icon name="spark" size={14} /> Small steps. Shared momentum.</div>
            </div>{view === 'home' && <div className="sl-home-chat"><div className="sl-panel-heading"><b><Icon name="hash" size={17} /> website-launch</b><span>TEAM CHAT</span></div><ChatMessages compact /><button className="sl-inline-link" onClick={() => setView('chat')}>Join the conversation <Icon name="arrow" size={14} /></button></div>}</div>
          </>}
          {view === 'chat' && <div className="sl-chat-view"><div className="sl-chat-day"><span />Today<span /></div><ChatMessages />{sentMessages.map((message, i) => <div className="sl-message sl-sent-message" key={i}><Avatar initials="JD" /><div><strong>Jordan <time>Just now · preview</time></strong><p>{message}</p></div></div>)}<form className="sl-chat-compose" onSubmit={event => { event.preventDefault(); if (chatDraft.trim()) { setSentMessages(current => [...current, chatDraft.trim()]); setChatDraft(''); } }}><input aria-label="Message in the illustrative team chat" placeholder="Message #website-launch" value={chatDraft} onChange={event => setChatDraft(event.target.value)} maxLength={250} /><button type="submit" disabled={!chatDraft.trim()} aria-label="Send preview message"><Icon name="arrow" size={18} /></button></form></div>}
          {view === 'calendar' && <div className="sl-planner-view"><div className="sl-planner-tasks"><span className="sl-app-eyebrow">TODAY’S PRIORITIES</span><h4>A little intention.</h4>{tasks.slice(0, 3).map(task => <div key={task.title}><Icon name="circleCheck" size={16} /><span>{task.title}<small>{task.project}</small></span></div>)}<p>Your plan can make space for both focused work and your team.</p></div><div className="sl-calendar"><div className="sl-calendar-head"><b>Monday</b><span>12</span></div>{['09:00', '10:00', '11:00', '12:00'].map((time, i) => <div className="sl-calendar-slot" key={time}><time>{time}</time><div>{i === 0 && <span className="sl-calendar-event">Team catch-up<small>Huddle · 30 min</small></span>}{i === 1 && <span className="sl-calendar-event sl-calendar-event-dark">Homepage final polish<small>Focus time · 60 min</small></span>}{i === 3 && <span className="sl-calendar-event">Client check-in<small>Meeting · 30 min</small></span>}</div></div>)}</div></div>}
        </div>
      </div>
    </div>
    <div className="sl-preview-caption"><span><span className="sl-tiny-dot" /> A shared space for a better workday.</span><span>Illustrative workspace · Try the tabs</span></div>
  </div>;
}

const essentials: { icon: IconName; title: string; description: string }[] = [
  { icon: 'circleCheck', title: 'Work with a clear next step.', description: 'Organize projects into spaces, assign tasks, and keep progress visible. Everyone knows what needs doing and who’s moving it forward.' },
  { icon: 'chat', title: 'Keep context in the conversation.', description: 'Bring your team together in channels and direct messages. Share updates, discuss the details, and jump into a huddle when talking is easier.' },
  { icon: 'calendar', title: 'Give your day a little direction.', description: 'See your tasks alongside your calendar. Plan focused work, make room for meetings, and build a routine that works for you.' },
  { icon: 'clock', title: 'Know where your time goes.', description: 'Track work as it happens, check in for the day, and turn everyday effort into clear timesheets for you and your team.' },
  { icon: 'document', title: 'Make knowledge a team asset.', description: 'Keep notes, documents, and learning resources close to the work. Give your squad a shared place to find answers and build on what they know.' },
  { icon: 'repeat', title: 'Keep the everyday work moving.', description: 'Set up recurring routines and follow through on shared goals. Bring the work that happens every week into the same workspace.' },
];

const featureLabels = ['Manage tasks & projects', 'Keep your team connected', 'Plan your day', 'Track your time', 'Build shared knowledge', 'Create everyday routines'];
const featureRows = [
  ['Homepage final polish', 'Campaign brief', 'Onboarding review'],
  ['# website-launch', '# team-updates', 'Direct messages'],
  ['09:00 · Team catch-up', '10:00 · Focus time', '12:00 · Client check-in'],
  ['Website launch · 1h 24m', 'Marketing · 45m', 'Product · 15m'],
  ['Website launch brief', 'Team handbook', 'Learning resources'],
  ['Weekly project review', 'Daily check-in', 'Monthly planning'],
];

function FeatureOverview() {
  const [active, setActive] = useState(0);
  return <section className="sl-overview sl-container" id="why-squadhub">
    <div className="sl-overview-intro"><span className="sl-section-label">Connected work</span><h2>A workspace that brings<br />your whole squad together.</h2><p>Bring the work, the people, and the context into one place.<br /> A little less switching. A lot more moving forward.</p></div>
    <div className="sl-feature-explorer"><div className="sl-feature-options">{essentials.map((feature, index) => <div className={`sl-feature-option ${active === index ? 'is-active' : ''}`} key={feature.title}><button aria-expanded={active === index} aria-controls="sl-feature-artwork" onClick={() => setActive(index)}><span className="sl-feature-indicator" />{featureLabels[index]}<Icon name={active === index ? 'down' : 'chevron'} size={15} /></button>{active === index && <p>{feature.description}</p>}</div>)}</div>
      <div className="sl-feature-artwork" id="sl-feature-artwork" aria-live="polite"><div className="sl-sculpture" aria-hidden="true"><i /><i /><i /><i /></div><div className="sl-feature-window"><div className="sl-feature-window-heading"><Icon name={essentials[active].icon} size={17} /><b>{featureLabels[active]}</b><Icon name="more" size={16} /></div><div className="sl-feature-window-sub">YOUR WORKSPACE, CONNECTED</div>{featureRows[active].map((row, index) => <div className="sl-feature-window-row" key={row}><span className="sl-feature-row-icon"><Icon name={essentials[active].icon} size={16} /></span><div><b>{row}</b><span>{active === 0 ? ['Website launch', 'Marketing', 'Product'][index] : active === 1 ? 'The conversation, with context' : active === 2 ? ['Huddle · 30 min', 'Deep work · 60 min', 'Meeting · 30 min'][index] : active === 3 ? 'Time well spent' : active === 4 ? 'A shared place for what you know' : 'Build a rhythm that works'}</span></div><Icon name="upRight" size={13} /></div>)}<div className="sl-feature-window-footer"><span className="sl-tiny-dot" /> A shared home for every next step.</div></div><span className="sl-artwork-caption">Illustrative workspace</span></div>
    </div>
  </section>;
}

export default function SquadHubLanding() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className="sl-page">
    <a href="#main" className="sl-skip">Skip to content</a>
    <header className="sl-header"><div className="sl-nav sl-container"><a href="#main" aria-label="SquadHub home"><Brand /></a><nav aria-label="Main navigation" className={menuOpen ? 'sl-nav-links is-open' : 'sl-nav-links'}><a href="#why-squadhub" onClick={() => setMenuOpen(false)}>Overview</a><a href="#essentials" onClick={() => setMenuOpen(false)}>Features</a><a href="#your-day" onClick={() => setMenuOpen(false)}>Your day</a><a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a></nav><div className="sl-nav-actions"><Link href="/login" className="sl-login">Log in</Link><Link href="/app" className="sl-button sl-button-small">Get started</Link><button className="sl-menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><Icon name={menuOpen ? 'close' : 'panel'} size={22} /></button></div></div></header>
    <main id="main">
      <section className="sl-hero"><div className="sl-container"><div className="sl-hero-copy"><div className="sl-eyebrow"><span className="sl-tiny-dot" /> Team collaboration, connected</div><h1>The shared workspace for<br /><span>your team’s best work.</span></h1><p>Bring your projects, conversations, and everyday work together.<br className="sl-desktop-break" /> One connected place for your whole squad to move forward.</p><div className="sl-hero-actions"><Link href="/app" className="sl-button">Get started now</Link><a href="#workspace" className="sl-button sl-button-outline">Explore the workspace</a></div></div><div className="sl-hero-product"><WorkspacePreview /></div></div></section>
      <div className="sl-value-strip sl-container">{[
        { icon: 'layers', title: 'Connected workspace', description: 'Your projects and priorities in one place' },
        { icon: 'chat', title: 'Team conversations', description: 'The people and context behind the work' },
        { icon: 'calendar', title: 'Intentional workdays', description: 'A clearer plan for your time and focus' },
        { icon: 'document', title: 'Shared knowledge', description: 'A home for everything your squad knows' },
      ].map(item => <div key={item.title}><div><Icon name={item.icon as IconName} size={18} /><b>{item.title}</b></div><p>{item.description}</p></div>)}</div>
      <FeatureOverview />
      <section className="sl-connected"><div className="sl-container"><div className="sl-connected-head"><div><span className="sl-section-label">Shared momentum</span><h2>On the same page.<br />In the same place.</h2></div><p>The work and the people behind it.<br />Connected from the first idea to the final check.</p></div><div className="sl-connected-grid"><article className="sl-connected-card sl-work-card"><div className="sl-card-label"><Icon name="circleCheck" size={18} /> CLEAR WORK, SHARED OWNERSHIP</div><h3>Big plans. Clear next steps.</h3><p>A home for every project, and a next step for every teammate.</p><div className="sl-mini-project"><div className="sl-mini-project-head"><span className="sl-project-symbol"><Icon name="layers" size={18} /></span><div><b>Website launch</b><span>One project. One shared finish line.</span></div><div className="sl-avatar-stack"><Avatar initials="AM" /><Avatar initials="SK" dark /><Avatar initials="JD" /></div></div><div className="sl-project-progress"><span>Launch checklist</span><b>3 of 4 complete</b></div><div className="sl-progress-track"><span /></div><div className="sl-mini-task"><span className="sl-filled-check"><Icon name="check" size={11} /></span><s>Bring the brief together</s><Avatar initials="AM" /></div><div className="sl-mini-task"><span className="sl-filled-check"><Icon name="check" size={11} /></span><s>Design the experience</s><Avatar initials="SK" /></div><div className="sl-mini-task"><span className="sl-filled-check"><Icon name="check" size={11} /></span><s>Get the squad’s feedback</s><Avatar initials="JD" /></div><div className="sl-mini-task"><span className="sl-empty-check" /><b>Make the final touches</b><span className="sl-status-pill">In progress</span></div></div></article><article className="sl-connected-card sl-conversation-card"><div className="sl-card-label"><Icon name="chat" size={18} /> PEOPLE, WITH THE CONTEXT</div><h3>A conversation that goes places.</h3><p>Updates, ideas, and a quick “got a minute?”—all close to the work.</p><div className="sl-mini-conversation"><div className="sl-mini-channel"><Icon name="hash" size={16} /><b>website-launch</b><Icon name="people" size={16} /></div><div className="sl-mini-message"><Avatar initials="AM" /><div><b>Anjali <span>Just now</span></b><p>One last review and we’re ready to go.</p><span className="sl-dark-attachment"><Icon name="circleCheck" size={14} /> Make the final touches <Icon name="upRight" size={12} /></span></div></div><div className="sl-huddle"><span className="sl-huddle-icon"><Icon name="video" size={20} /></span><div><b>Talk it through.</b><span>A quick huddle. A clear decision.</span></div><span className="sl-huddle-wave"><i /><i /><i /><i /><i /></span></div></div></article></div></div></section>
      <section className="sl-essentials sl-container" id="essentials"><div className="sl-section-intro"><span className="sl-section-label">Everyday essentials</span><h2>A place for everything<br />that moves work forward.</h2><p>From your first check-in to your final task.<br />The tools your squad needs, in a workspace that makes sense.</p></div><div className="sl-essentials-grid">{essentials.map((item, i) => <article key={item.title}><div className="sl-essential-top"><span className="sl-essential-icon"><Icon name={item.icon} size={23} /></span><span>0{i + 1}</span></div><h3>{item.title}</h3><p>{item.description}</p></article>)}</div></section>
      <section className="sl-day sl-container" id="your-day"><div className="sl-day-copy"><span className="sl-section-label">Your day, with clarity</span><h2>Start with focus.<br />Finish with progress.</h2><p>SquadHub gives you a personal home inside your team’s workspace. See what needs your attention, shape your day, and make your effort visible.</p><ol><li><span>01</span><div><b>Find your focus.</b><p>Bring your priorities into a clear daily list.</p></div></li><li><span>02</span><div><b>Make time for the work.</b><p>Plan your day and track time as you go.</p></div></li><li><span>03</span><div><b>Keep your squad in the loop.</b><p>Share progress where the work happens.</p></div></li></ol></div><div className="sl-day-visual"><div className="sl-day-visual-top"><span>MY DAY</span><Icon name="sun" size={21} /></div><h3>A little structure.<br />A lot of possibility.</h3><div className="sl-day-timeline"><div><time>09:00</time><span><Icon name="people" size={17} /><div><b>Get in sync</b><small>Team catch-up</small></div><span className="sl-timeline-duration">30 min</span></span></div><div><time>10:00</time><span className="sl-timeline-focus"><Icon name="circleCheck" size={17} /><div><b>Do the deep work</b><small>Homepage final polish</small></div><span className="sl-timeline-duration">60 min</span></span></div><div><time>11:00</time><span><Icon name="document" size={17} /><div><b>Share what you know</b><small>Update the launch notes</small></div><span className="sl-timeline-duration">30 min</span></span></div></div><div className="sl-day-footer"><span><Icon name="clock" size={16} /> Time with a purpose.</span><span className="sl-day-footer-pill">Your day, your rhythm</span></div></div></section>
      <section className="sl-faq sl-container" id="faq"><div><span className="sl-section-label">Answering questions</span><h2>Everything explained<br />to help you get started.</h2><p className="sl-faq-intro">A few things to know about your workspace,<br />your team, and the way it all comes together.</p></div><div className="sl-faq-items">{[
        ['What is SquadHub?', 'SquadHub is a shared workspace for team collaboration and project management. It brings tasks, team chat, calendar planning, time tracking, notes, and learning resources together.'],
        ['Who is it built for?', 'SquadHub is built for teams that work together on projects, including internal teams, partners, and people coordinating client work. It gives each person a daily workspace and the squad a shared view of the work.'],
        ['Can I use it outside my browser?', 'Yes. SquadHub has a desktop companion and mobile apps, so your workspace can stay close whether you’re at your desk or on the move. You can find the available downloads from the app download page.'],
        ['How do I get into my workspace?', 'Use “Open SquadHub” to enter the app, or log in with your SquadHub account. If you’re new, the sign-up page will help you create an account.'],
      ].map(([question, answer]) => <details key={question}><summary>{question}<span className="sl-faq-plus"><Icon name="plus" size={18} /></span></summary><p>{answer}{question === 'Can I use it outside my browser?' && <> <Link href="/download-app">View app downloads <Icon name="upRight" size={12} /></Link></>}</p></details>)}</div></section>
      <section className="sl-final-cta"><div className="sl-container"><span className="sl-section-label">Get started</span><h2>Make room for<br />your best work.</h2><p>Your people. Your projects. Your next big thing.<br />Give them a shared home.</p><Link href="/app" className="sl-button sl-button-white">Open SquadHub <Icon name="arrow" size={18} /></Link><span className="sl-final-note">New to the squad? <Link href="/signup">Create an account <Icon name="upRight" size={12} /></Link></span><span className="sl-cta-watermark" aria-hidden="true">SH.</span></div></section>
    </main>
    <footer className="sl-footer sl-container"><div><a href="#main" aria-label="SquadHub home"><Brand /></a><p>A shared space. A stronger squad.</p></div><nav aria-label="Footer navigation"><a href="#workspace">The workspace</a><Link href="/download-app">Get the app <Icon name="upRight" size={13} /></Link><Link href="/login">Log in</Link></nav><span>© {new Date().getFullYear()} SquadHub<br /><span>Powered by UpSquad</span></span></footer>
  </div>;
}
