'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { TaskType } from '@squadhub/shared';

export const DEFAULT_TASK_TYPE_GROUPS: Record<string, string> = {
  task: 'Task Types',
  todo: 'Task Types',
  work_block: 'Task Types',
  focus_task: 'Task Types',
  multi_day_task: 'Task Types',
  routine: 'Task Types',
  plan: 'Task Types',

  commute: 'Location-Based',
  travel: 'Location-Based',
  out_of_office: 'Location-Based',

  meeting: 'Meetings & Collaboration',
  call: 'Meetings & Collaboration',
  e_meet: 'Meetings & Collaboration',
  in_person_meeting: 'Meetings & Collaboration',
  events: 'Meetings & Collaboration',
  brainstorm_session: 'Meetings & Collaboration',

  learning: 'Learning & Exploration',
  research: 'Learning & Exploration',
  course: 'Learning & Exploration',
  sop: 'Learning & Exploration',
  knowledge: 'Learning & Exploration',

  follow_ups: 'Follow-ups & Monitoring',

  recording: 'Media Creation',
  design_task: 'Media Creation',
  video_edit_task: 'Media Creation',
  post: 'Media Creation',

  activities: 'Action-Oriented Activities',

  milestone: 'Goals & Milestones',
  goal: 'Goals & Milestones',

  chores: 'Personal',

  coding: 'Software Development',
  testing: 'Software Development',
  ui_designing: 'Software Development',

  quick_wins: 'Planning & Review',
  review: 'Planning & Review',
  on_hold: 'Planning & Review',
  parked_task: 'Planning & Review',
};

export const DEFAULT_TASK_TYPE_DESCRIPTIONS: Record<string, string> = {
  task: 'Requires more than 10 minutes to complete.',
  todo: 'Quick tasks that take only a couple of minutes to finish.',
  work_block: 'Similar tasks grouped together to be completed in a time block.',
  focus_task: 'Tasks requiring uninterrupted focus and deep work to complete.',
  multi_day_task: 'Larger tasks broken down into daily efforts, spanning several days.',
  routine: 'Recurring tasks done at regular intervals (daily, weekly, etc.).',
  plan: 'Tasks involving preparation, strategy, or setup before execution.',

  commute: 'Short-distance travel for a purpose.',
  travel: 'Long-distance travel for work or personal reasons.',
  out_of_office: 'Activities requiring you to go outside your usual workspace.',

  meeting: 'Scheduled meetings and collaborative sessions.',
  call: 'Phone or audio-only communication.',
  e_meet: 'Online meeting with video or screen sharing.',
  in_person_meeting: 'Face-to-face meetings.',
  events: 'Attending or organising events.',
  brainstorm_session: 'Collaborative idea-generation meetings.',

  learning: 'Activities focused on acquiring knowledge by reading, watching, or listening.',
  research: 'Tasks involving investigation, testing, and implementation.',
  course: 'Courses that need to be completed',
  sop: 'A system / process step assigned to you',
  knowledge: 'A knowledge document page to review',

  follow_ups: 'Checking back with someone or following up on pending actions.',

  recording: 'Creating audio or video recordings for various purposes.',
  design_task: 'Visual design deliverables',
  video_edit_task: 'Video editing deliverables',
  post: 'A resource update assigned to you',

  activities: 'Engaging, interactive tasks like physical activities or hobbies.',

  milestone: 'Task Type is milestone',
  goal: 'Task Type is Goal',

  chores: 'For Household work related tasks, like cleaning, laundry etc',

  coding: 'Software engineering, feature implementation, and bug fixing.',
  testing: 'Writing and executing tests, QA verification, and bug validation.',
  ui_designing: 'User interface design, wireframes, and prototyping.',

  quick_wins: 'Small but impactful tasks that can be done quickly to move things forward.',
  review: 'Revisiting past work, reports, or plans to evaluate or update them.',
  on_hold: 'Tasks that are on hold',
  parked_task: 'Tasks that have been moved aside for working on someday later',
};

export const TASK_TYPE_KEYWORDS: Record<string, string[]> = {
  follow_ups: ['waiting on', 'followups', 'follow up', 'pending'],
  todo: ['quick', 'minutes', 'short', 'fast'],
  chores: ['cleaning', 'laundry', 'household', 'home'],
  work_block: ['focus session', 'time block', 'timer'],
  focus_task: ['deep work', 'uninterrupted', 'concentration'],
  coding: ['code', 'developer', 'dev', 'programming', 'bugfix', 'frontend', 'backend', 'api', 'software'],
  testing: ['test', 'qa', 'quality', 'verification', 'spec', 'bug', 'cypress', 'jest'],
  ui_designing: ['ui', 'ux', 'design', 'figma', 'wireframe', 'mockup', 'interface', 'layout'],
  quick_wins: ['impactful', 'fast', 'quick'],
  on_hold: ['paused', 'delayed', 'frozen', 'waiting'],
  parked_task: ['someday', 'later', 'backlog', 'shelved', 'aside'],
};

export const GROUP_ORDER = [
  'Task Types',
  'Software Development',
  'Location-Based',
  'Meetings & Collaboration',
  'Learning & Exploration',
  'Follow-ups & Monitoring',
  'Media Creation',
  'Action-Oriented Activities',
  'Goals & Milestones',
  'Personal',
  'Planning & Review',
];

export function getTaskTypeGroup(t: TaskType): string {
  return t.group_name || DEFAULT_TASK_TYPE_GROUPS[t.key] || 'Other';
}

export function getTaskTypeDescription(t: TaskType): string {
  return t.description || DEFAULT_TASK_TYPE_DESCRIPTIONS[t.key] || '';
}

/** Crisp inline SVG icons for task types */
export function TaskTypeGlyph({ icon, size = 14, color }: { icon?: string; size?: number; color?: string }) {
  const stroke = color || 'currentColor';
  switch (icon) {
    case 'check-square':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case 'check-circle-2':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'clock':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'target':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case 'calendar-range':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="4" rx="2" />
          <line x1="16" x2="16" y1="2" y2="6" />
          <line x1="8" x2="8" y1="2" y2="6" />
          <line x1="3" x2="21" y1="10" y2="10" />
          <path d="M17 14h-6" />
          <path d="M13 18H7" />
        </svg>
      );
    case 'repeat':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m17 2 4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="m7 22-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
      );
    case 'compass':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </svg>
      );
    case 'car':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9C2.1 11.1 2 11.5 2 12v4c0 .6.4 1 1 1h2" />
          <circle cx="7" cy="17" r="2" />
          <path d="M9 17h6" />
          <circle cx="17" cy="17" r="2" />
        </svg>
      );
    case 'plane':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
        </svg>
      );
    case 'briefcase':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      );
    case 'users':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'phone':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case 'video':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m22 8-6 4 6 4V8Z" />
          <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
        </svg>
      );
    case 'calendar':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="4" rx="2" />
          <line x1="16" x2="16" y1="2" y2="6" />
          <line x1="8" x2="8" y1="2" y2="6" />
          <line x1="3" x2="21" y1="10" y2="10" />
        </svg>
      );
    case 'lightbulb':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
          <path d="M9 18h6" />
          <path d="M10 22h4" />
        </svg>
      );
    case 'book-open':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    case 'search':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case 'graduation-cap':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" />
          <path d="M22 10v6" />
          <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" />
        </svg>
      );
    case 'clipboard-list':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M12 11h4" />
          <path d="M12 16h4" />
          <path d="M8 11h.01" />
          <path d="M8 16h.01" />
        </svg>
      );
    case 'file-check':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="m9 15 2 2 4-4" />
        </svg>
      );
    case 'mic':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      );
    case 'palette':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </svg>
      );
    case 'file-text':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
        </svg>
      );
    case 'zap':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'flag':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" x2="4" y1="22" y2="15" />
        </svg>
      );
    case 'trophy':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
          <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      );
    case 'home':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      );
    case 'clipboard-check':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="m9 14 2 2 4-4" />
        </svg>
      );
    case 'pause-circle':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="10" x2="10" y1="15" y2="9" />
          <line x1="14" x2="14" y1="15" y2="9" />
        </svg>
      );
    case 'archive':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="20" height="5" x="2" y="3" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </svg>
      );
    case 'code':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case 'test-tube':
    case 'flask-conical':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2v7.31L4.69 19.3A2 2 0 0 0 6.44 22h11.12a2 2 0 0 0 1.75-2.7L14 9.31V2" />
          <line x1="8.5" x2="15.5" y1="2" y2="2" />
          <line x1="7" x2="17" y1="14" y2="14" />
        </svg>
      );
    case 'bug':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="8" height="14" x="8" y="6" rx="4" />
          <path d="m19 7-3 2" />
          <path d="m5 7 3 2" />
          <path d="m19 19-3-2" />
          <path d="m5 19 3-2" />
          <path d="M20 13h-4" />
          <path d="M4 13h4" />
          <path d="m10 4 1 2" />
          <path d="m14 4-1 2" />
        </svg>
      );
    case 'layout':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <line x1="3" x2="21" y1="9" y2="9" />
          <line x1="9" x2="9" y1="21" y2="9" />
        </svg>
      );
    default:
      return (
        <span
          className="inline-block rounded-full"
          style={{ width: size * 0.6, height: size * 0.6, backgroundColor: stroke }}
        />
      );
  }
}

export interface TaskTypeDropdownProps {
  taskTypes: TaskType[];
  current?: TaskType | null;
  value?: string | null;
  canEdit?: boolean;
  disabled?: boolean;
  onChange: (type: TaskType) => void;
  className?: string;
  trigger?: React.ReactNode;
  placeholder?: string;
  filterKeys?: string[];
  align?: 'left' | 'right';
  width?: number;
}

export default function TaskTypeDropdown({
  taskTypes = [],
  current,
  value,
  canEdit = true,
  disabled = false,
  onChange,
  className = '',
  trigger,
  placeholder = 'Select type',
  filterKeys,
  align = 'left',
  width = 330,
}: TaskTypeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Resolved current type
  const activeType = useMemo(() => {
    if (current) return current;
    if (value) return taskTypes.find((t) => t.id === value || t.key === value) || null;
    return null;
  }, [current, value, taskTypes]);

  // Filter types by filterKeys if provided
  const availableTypes = useMemo(() => {
    if (!filterKeys || filterKeys.length === 0) return taskTypes;
    return taskTypes.filter((t) => !filterKeys.includes(t.key));
  }, [taskTypes, filterKeys]);

  // Filtered and grouped
  const { grouped, flatList } = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = availableTypes.filter((t) => {
      if (!q) return true;
      const name = (t.name || '').toLowerCase();
      const desc = getTaskTypeDescription(t).toLowerCase();
      const group = getTaskTypeGroup(t).toLowerCase();
      const key = (t.key || '').toLowerCase();
      const keywords = (TASK_TYPE_KEYWORDS[t.key] || []).join(' ').toLowerCase();

      return (
        name.includes(q) ||
        desc.includes(q) ||
        group.includes(q) ||
        key.includes(q) ||
        keywords.includes(q)
      );
    });

    // Grouping
    const groupsMap = new Map<string, TaskType[]>();
    for (const t of filtered) {
      const g = getTaskTypeGroup(t);
      const list = groupsMap.get(g) || [];
      list.push(t);
      groupsMap.set(g, list);
    }

    // Sort groups according to predefined order
    const sortedGroups: { groupName: string; items: TaskType[] }[] = [];
    for (const gName of GROUP_ORDER) {
      if (groupsMap.has(gName)) {
        sortedGroups.push({ groupName: gName, items: groupsMap.get(gName)! });
        groupsMap.delete(gName);
      }
    }
    // Any remaining custom groups
    for (const [gName, items] of groupsMap.entries()) {
      sortedGroups.push({ groupName: gName, items });
    }

    const flat: TaskType[] = [];
    for (const g of sortedGroups) {
      flat.push(...g.items);
    }

    return { grouped: sortedGroups, flatList: flat };
  }, [availableTypes, search]);

  const toggle = useCallback(() => {
    if (!canEdit || disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    if (btnRef.current) {
      setRect(btnRef.current.getBoundingClientRect());
    }
    setSearch('');
    setHighlightedIndex(0);
    setOpen(true);
  }, [open, canEdit, disabled]);

  // Focus search input on open
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1 < flatList.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : flatList.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatList[highlightedIndex]) {
        onChange(flatList[highlightedIndex]);
        setOpen(false);
      }
    }
  };

  const popStyle = useMemo<React.CSSProperties>(() => {
    if (!rect) return { visibility: 'hidden' as const };
    const maxH = 420;
    const popW = Math.min(width, window.innerWidth - 24);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 260 && rect.top > spaceBelow;

    let left = align === 'right' ? rect.right - popW : rect.left;
    if (left + popW > window.innerWidth - 12) {
      left = window.innerWidth - popW - 12;
    }
    if (left < 12) left = 12;

    return {
      position: 'fixed',
      top: openUp ? Math.max(8, rect.top - maxH - 6) : rect.bottom + 6,
      left,
      width: popW,
      maxHeight: maxH,
      zIndex: 9999,
      borderColor: 'var(--sh-hair)',
      background: 'var(--surface)',
      boxShadow: '0 12px 36px -4px rgba(0,0,0,0.22), 0 4px 12px -2px rgba(0,0,0,0.12)',
    };
  }, [rect, width, align]);

  return (
    <>
      {trigger ? (
        <span
          ref={btnRef as any}
          onClick={canEdit && !disabled ? toggle : undefined}
          style={{ cursor: canEdit && !disabled ? 'pointer' : 'default', display: 'inline-block' }}
        >
          {trigger}
        </span>
      ) : (
        <button
          ref={btnRef}
          type="button"
          onClick={canEdit && !disabled ? toggle : undefined}
          disabled={!canEdit || disabled}
          className={`td-prop-chip ${className}`}
          style={{
            cursor: canEdit && !disabled ? 'pointer' : 'default',
            background: activeType?.color
              ? `color-mix(in oklch, ${activeType.color} 14%, transparent)`
              : 'var(--surface-alt)',
            color: activeType?.color || 'var(--sh-ink-3)',
          }}
        >
          <span className="dot" style={{ background: activeType?.color || 'var(--sh-ink-4)' }} />
          <span className="truncate max-w-[150px]">{activeType?.name || placeholder}</span>
          {canEdit && !disabled && (
            <svg className="ml-1 opacity-50 shrink-0" width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      )}

      {open && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />

          <div
            ref={popRef}
            className="flex flex-col rounded-xl border overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100"
            style={popStyle}
            onKeyDown={handleKeyDown}
          >
            {/* Search Header */}
            <div className="p-2.5 border-b border-[var(--sh-hair)] bg-[var(--surface)] shrink-0">
              <div className="relative flex items-center">
                <svg
                  className="absolute left-2.5 w-3.5 h-3.5 pointer-events-none text-[var(--sh-ink-4)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setHighlightedIndex(0);
                  }}
                  placeholder="Search task types (e.g. Focus, Plan, Call)..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--surface-alt)] border border-[var(--sh-hair)] rounded-lg text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]/20"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-2 text-xs text-[var(--sh-ink-4)] hover:text-[var(--sh-ink-2)]"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1 py-1 divide-y divide-[var(--sh-hair)]/40 scrollbar-thin">
              {grouped.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--surface-alt)] text-[var(--sh-ink-4)] mb-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-[var(--sh-ink-2)]">No task types found</p>
                  <p className="text-[11px] text-[var(--sh-ink-4)] mt-0.5">Try searching with a different term</p>
                </div>
              ) : (
                grouped.map((group) => (
                  <div key={group.groupName} className="py-1">
                    {/* Group Header */}
                    <div className="px-3 py-1 flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase text-[var(--sh-ink-4)] bg-[var(--surface)] select-none">
                      <span>{group.groupName}</span>
                      <span className="text-[9px] opacity-70 font-normal">{group.items.length}</span>
                    </div>

                    {/* Group Items */}
                    <div className="space-y-0.5 px-1">
                      {group.items.map((t) => {
                        const isSelected = activeType?.id === t.id;
                        const flatIdx = flatList.indexOf(t);
                        const isHighlighted = flatIdx === highlightedIndex;
                        const desc = getTaskTypeDescription(t);

                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              onChange(t);
                              setOpen(false);
                            }}
                            onMouseEnter={() => setHighlightedIndex(flatIdx)}
                            className={`group w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                              isSelected
                                ? 'bg-[#2962FF]/10 text-[var(--sh-ink)]'
                                : isHighlighted
                                ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                                : 'hover:bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                            }`}
                          >
                            {/* Icon badge */}
                            <div
                              className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${t.color || '#6b7280'} 16%, transparent)`,
                                color: t.color || 'var(--sh-ink-3)',
                              }}
                            >
                              <TaskTypeGlyph icon={t.icon} color={t.color} size={12} />
                            </div>

                            {/* Name + Description */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[12.5px] font-medium text-[var(--sh-ink)] leading-snug truncate">
                                  {t.name}
                                </span>
                                {t.is_default && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-medium bg-[var(--surface-alt)] text-[var(--sh-ink-4)] border border-[var(--sh-hair)]">
                                    Default
                                  </span>
                                )}
                              </div>
                              {desc && (
                                <p className="text-[11px] text-[var(--sh-ink-3)] leading-tight mt-0.5 line-clamp-2 opacity-85">
                                  {desc}
                                </p>
                              )}
                            </div>

                            {/* Selection checkmark */}
                            {isSelected && (
                              <svg
                                className="w-4 h-4 text-[#2962FF] shrink-0 mt-0.5"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Bottom count footer */}
            <div className="px-3 py-1.5 bg-[var(--surface-alt)] border-t border-[var(--sh-hair)] text-[10.5px] text-[var(--sh-ink-4)] flex items-center justify-between shrink-0">
              <span>{flatList.length} task type{flatList.length !== 1 ? 's' : ''} available</span>
              <span className="text-[9.5px]">Use ↑↓ to navigate, ↵ to pick</span>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
