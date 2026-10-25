/**
 * Home: the hero with the app live under it, observable self-evolution with its demo, the
 * one-sentence case, what PenguinHarness is made of, what is already built around the agent, the
 * cost comparison, customer scenarios, the latest posts, how to install, and the close.
 */
import { Hero } from "../sections/hero";
import { Evolve } from "../sections/evolve";
import { Cases } from "../sections/cases";
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
      <Evolve />
      <Cases />
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
