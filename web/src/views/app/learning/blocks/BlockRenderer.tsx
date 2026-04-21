'use client';
import type { LmsContentBlock } from '@squadhub/shared';
import TextBlock from './TextBlock';
import { ImageBlock, VideoUploadBlock, AudioBlock, PdfBlock } from './MediaBlock';
import VideoEmbedBlock from './VideoEmbedBlock';
import QuizBlock from './QuizBlock';

export default function BlockRenderer({ block, assignmentId }: {
  block: LmsContentBlock;
  assignmentId: string | null;
}) {
  switch (block.type) {
    case 'text':
      return <TextBlock content={block.text_content} />;
    case 'image':
      return <ImageBlock block={block} />;
    case 'video_upload':
      return <VideoUploadBlock block={block} />;
    case 'video_embed':
      return <VideoEmbedBlock block={block} />;
    case 'audio':
      return <AudioBlock block={block} />;
    case 'pdf':
      return <PdfBlock block={block} />;
    case 'quiz':
      return <QuizBlock block={block} assignmentId={assignmentId} />;
    default:
      return null;
  }
}
