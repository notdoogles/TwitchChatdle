import styles from './AdSidebar.module.css';

interface AdSidebarLayoutProps {
  children: React.ReactNode;
  image?: string;
  text?: string;
}

// Optional sponsor sidebar, wrapping the page body. Gated behind
// getAdSidebarImage() (see lib/config.ts) so a deployment without an
// AD_SIDEBAR_IMAGE (the default) renders exactly as if this component
// weren't there.
export default function AdSidebarLayout({ children, image, text }: AdSidebarLayoutProps) {
  if (!image) return <>{children}</>;

  return (
    <div className={styles.bodyRow}>
      <div className={styles.contentColumn}>{children}</div>
      <aside className={styles.adSidebar}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.adFooterImage} src={image} alt={text ?? 'Sponsor'} />
        {text && <span className={styles.adFooterText}>{text}</span>}
      </aside>
    </div>
  );
}
