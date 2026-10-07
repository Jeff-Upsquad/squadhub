'use client';

import React from 'react';
import api from '../../../services/api';
import { openExternalUrl } from '../../../lib/openExternal';
import { createBotDoubtCard } from '@squad-bots/core/ui/BotDoubtCard';

const InnerBotDoubtCard = createBotDoubtCard({ api, openExternalUrl });

interface Props {
  message: any;
  onOpenThread?: () => void;
  inThread?: boolean;
}

interface State {
  hasError: boolean;
}

class BotDoubtCardErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Failed to render BotDoubtCard:', error);
  }

  render() {
    if (this.state.hasError) {
      const { message, onOpenThread } = this.props;
      return (
        <div
          className="mx-4 my-1 p-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300 cursor-pointer flex items-center justify-between"
          onClick={onOpenThread}
        >
          <span className="truncate">
            Bot query: {message?.content || message?.metadata?.question || 'Click to view thread'}
          </span>
          <span className="text-[10px] uppercase font-semibold tracking-wider text-amber-600 dark:text-amber-400 shrink-0 ml-2">
            View
          </span>
        </div>
      );
    }
    return <InnerBotDoubtCard {...this.props} />;
  }
}

export default BotDoubtCardErrorBoundary;
