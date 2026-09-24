import { GuestOnly } from "@/components/home/GuestOnly";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeModes } from "@/components/home/HomeModes";
import { HowItWorks } from "@/components/home/HowItWorks";
import { NextCups } from "@/components/home/NextCups";
import styles from "./home.module.css";

export default function HomePage() {
  return (
    <GuestOnly>
      <div className={`container ${styles.page}`}>
        <HomeHero />
        <HomeModes />
        <HowItWorks />
        <NextCups />
      </div>
    </GuestOnly>
  );
}
