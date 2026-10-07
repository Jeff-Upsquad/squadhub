'use client';

import React from 'react';
import api from '../../../services/api';
import ManageMembersModal from '../pm/ManageMembersModal';
import { createBotQuestions } from '@squad-bots/core/ui/BotQuestions';

const InnerBotQuestions = createBotQuestions({ api, ManageMembersModal });

class BotQuestionsErrorBoundary extends React.Component<
  { channelId: string; canManage?: boolean },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Failed to render BotQuestions:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg border border-amber-500/30">
          Unable to display bot questions at this time.
        </div>
      );
    }
    return <InnerBotQuestions {...this.props} />;
  }
}

export default BotQuestionsErrorBoundary;
