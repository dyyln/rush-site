import { rushRoomImage, rushRoomName } from "@/lib/rushRooms";
import styles from "./Rush.module.css";

// Screenshot of a room, or a plain card with the name for an unknown room
export function RoomImage({ room, dim }: { room: string; dim?: boolean }) {
  const src = rushRoomImage(room);
  if (!src) {
    return (
      <span className={styles.placeholder} data-dim={dim || undefined} aria-hidden="true">
        <span className="mono">{rushRoomName(room)}</span>
      </span>
    );
  }
  return <img className={styles.image} data-dim={dim || undefined} src={src} alt="" width={320} height={200} loading="lazy" decoding="async" />;
}
