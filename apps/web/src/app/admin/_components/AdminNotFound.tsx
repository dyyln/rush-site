import Link from "next/link";
import styles from "../admin.module.css";

// Same page for signed out users, non admins and unknown admin routes
export function AdminNotFound() {
  return (
    <div className="container">
      <div className={styles.notFound}>
        <p className={styles.notFoundCode}>404</p>
        <h1>Page not found</h1>
        <p className="muted">The page you are looking for does not exist.</p>
        <Link href="/">Back to home</Link>
      </div>
    </div>
  );
}
