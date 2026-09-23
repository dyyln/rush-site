import { HomeHero } from "@/components/home/HomeHero";
import { NextCups } from "@/components/home/NextCups";
import { WatchLive } from "@/components/home/WatchLive";
import styles from "./home.module.css";

export default function HomePage() {
  return (
    <div className={`container page ${styles.page}`}>
      <HomeHero />
      <NextCups />
      <WatchLive />
    </div>
  );
}
