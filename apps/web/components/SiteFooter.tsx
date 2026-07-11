import styles from './SiteFooter.module.css';

const LINKS = [
  {
    name: 'GitHub',
    href: 'https://github.com/notdoogles',
    icon: (
      <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.94 3.2 9.13 7.65 10.6.56.1.76-.24.76-.54 0-.27-.01-1.17-.02-2.12-3.11.68-3.77-1.32-3.77-1.32-.51-1.29-1.24-1.64-1.24-1.64-1.01-.69.08-.67.08-.67 1.12.08 1.71 1.15 1.71 1.15.99 1.7 2.6 1.21 3.24.92.1-.72.39-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.51 0-1.22.43-2.21 1.15-3-.12-.28-.5-1.41.11-2.94 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.61 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.53.23 2.66.11 2.94.72.79 1.15 1.78 1.15 3 0 4.28-2.62 5.23-5.11 5.5.4.35.76 1.03.76 2.08 0 1.5-.01 2.71-.01 3.08 0 .3.2.65.77.54 4.44-1.48 7.64-5.66 7.64-10.6C23.25 5.48 18.27.5 12 .5Z" />
    ),
  },
  {
    name: 'Twitch',
    href: 'https://twitch.tv/notdoogles',
    icon: (
      <path d="M4.3 1 1.9 6.8v13.6h5.1V24h2.9l2.9-3.6h4.3L22.1 15V1H4.3Zm16 13.1-3.4 3.4h-4.8l-2.9 3v-3H5.7V2.9h14.6v11.2Z m-2.9-8.4h-1.9v6.7h1.9V5.7Zm-5.3 0H10.2v6.7h1.9V5.7Z" />
    ),
  },
  {
    name: 'Discord',
    href: 'https://www.discord.com/users/219505484984614912',
    icon: (
      <path d="M20.3 4.4A19.9 19.9 0 0 0 15.4 3l-.3.6a14 14 0 0 1 4.3 1.7 16.7 16.7 0 0 0-14.8 0 14 14 0 0 1 4.3-1.7L8.6 3a19.8 19.8 0 0 0-4.9 1.4A21.4 21.4 0 0 0 1.5 17.2a13.9 13.9 0 0 0 4.4 2.2l.7-1.1a9.6 9.6 0 0 1-2-1l.5-.4a15.4 15.4 0 0 0 13.8 0l.5.4a9.6 9.6 0 0 1-2 1l.7 1.1a13.9 13.9 0 0 0 4.4-2.2 21.5 21.5 0 0 0-2.1-12.8ZM8.9 14.6c-.9 0-1.7-.9-1.7-1.9s.7-1.9 1.7-1.9 1.7.9 1.7 1.9-.8 1.9-1.7 1.9Zm6.2 0c-.9 0-1.7-.9-1.7-1.9s.7-1.9 1.7-1.9 1.7.9 1.7 1.9-.7 1.9-1.7 1.9Z" />
    ),
  },
];

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <span className={styles.text}>Created by Doogles</span>
      <div className={styles.links}>
        {LINKS.map(({ name, href, icon }) => (
          <a
            key={name}
            className={styles.link}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={name}
            title={name}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              {icon}
            </svg>
          </a>
        ))}
      </div>
      <span className={styles.note}>Questions? I&apos;m most reachable on Discord.</span>
    </footer>
  );
}
