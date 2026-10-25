/**
 * Home: the hero with the app live under it, three rows of the app at work, the self-evolution
 * loop with its demo, A2APP (an agent growing its own apps), what PenguinHarness is made of, what
 * is already built around the agent, the cost comparison, customer scenarios, the latest posts,
 * how to install, and the close.
 */
import { Hero } from "../sections/hero";
import { Showcase } from "../sections/showcase";
import { SelfImprove } from "../sections/self-improve";
import { A2app } from "../sections/a2app";
import { Pillars } from "../sections/pillars";
import { Compare } from "../sections/compare";
import { Benchmark } from "../sections/benchmark";
import { Scenarios } from "../sections/scenarios";
import { Updates } from "../sections/updates";
import { Quickstart } from "../sections/quickstart";
import { Cta } from "../sections/cta";
import { Community } from "../sections/community";

export function HomePage() {
  return (
    <>
      <Hero />
      <Showcase />
      <SelfImprove />
      <A2app />
      <Pillars />
      <Compare />
      <Benchmark />
      <Scenarios />
      <Updates />
      <Quickstart />
      <Cta />
      <Community />
    </>
  );
}
