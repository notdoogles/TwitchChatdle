'use client';

import { useState } from 'react';
import styles from './GameBoard.module.css';
import { filterUsernameSuggestions } from '@/lib/usernameSuggestions';

interface GuessFormProps {
  usernameHints: string[];
  submitting: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  // Resolves to true when the guess was accepted by the server; the form
  // clears its input only then (a failed guess keeps the text for retry).
  onSubmitGuess: (guess: string) => Promise<boolean>;
  onSkip: () => void;
}

export default function GuessForm({ usernameHints, submitting, inputRef, onSubmitGuess, onSkip }: GuessFormProps) {
  const [guessValue, setGuessValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  const suggestions = filterUsernameSuggestions(usernameHints, guessValue);
  const suggestionsOpen = showSuggestions && suggestions.length > 0;

  function selectSuggestion(name: string) {
    setGuessValue(name);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    inputRef.current?.focus();
  }

  function handleGuessKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      // Only intercept Enter when a suggestion is highlighted, otherwise
      // let the form submit the typed guess as-is.
      e.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveSuggestion(-1);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !guessValue.trim()) return;
    const ok = await onSubmitGuess(guessValue);
    if (ok) {
      setGuessValue('');
      setShowSuggestions(false);
      setActiveSuggestion(-1);
    }
  }

  return (
    <form className={styles.inputRow} onSubmit={handleSubmit} aria-busy={submitting}>
      <div className={styles.inputWrap}>
        <input
          ref={inputRef}
          className={styles.input}
          value={guessValue}
          disabled={submitting}
          onChange={(e) => {
            setGuessValue(e.target.value);
            setShowSuggestions(true);
            setActiveSuggestion(-1);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setShowSuggestions(false)}
          onKeyDown={handleGuessKeyDown}
          placeholder="Guess a username..."
          autoComplete="off"
          // autoComplete="off" alone doesn't stop password managers from
          // offering to fill a text input, so opt out explicitly per vendor.
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-dashlaneignore="true"
          data-roboformignore="true"
          data-form-type="other"
          role="combobox"
          aria-expanded={suggestionsOpen}
          aria-controls="username-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={
            activeSuggestion >= 0 ? `username-suggestion-${activeSuggestion}` : undefined
          }
          aria-label="Guess a username"
        />
        {suggestionsOpen && (
          <ul className={styles.suggestions} id="username-suggestions" role="listbox">
            {suggestions.map((name, i) => (
              <li
                key={name}
                id={`username-suggestion-${i}`}
                role="option"
                aria-selected={i === activeSuggestion}
                className={i === activeSuggestion ? styles.suggestionActive : styles.suggestion}
                // onMouseDown (not onClick) fires before the input's blur,
                // and preventDefault keeps focus on the input.
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(name);
                }}
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className={styles.skipButton} onClick={onSkip} disabled={submitting}>
        Skip
      </button>
      <button type="submit" className={styles.sendButton} disabled={submitting}>
        {submitting ? 'Guessing…' : 'Guess'}
      </button>
    </form>
  );
}
