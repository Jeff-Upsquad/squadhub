import { forwardRef } from 'react';

interface ViewSearchInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

const ViewSearchInput = forwardRef<HTMLInputElement, ViewSearchInputProps>(
  function ViewSearchInput({ value, onChange, placeholder = 'Search tasks...' }, ref) {
    return (
      <div className="lv-search">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref={ref}
          data-view-search="true"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <kbd>/</kbd>
      </div>
    );
  },
);

export default ViewSearchInput;
