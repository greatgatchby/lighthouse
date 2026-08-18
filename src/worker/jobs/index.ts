import type { JobDefinition } from "../types";

import backup from "./backup";
import categorise from "./categorise";
import detectRecurring from "./detectRecurring";
import digest from "./digest";
import docIngest from "./docIngest";
import expiryCheck from "./expiryCheck";
import impulseCheck from "./impulseCheck";
import lunchflowSync from "./lunchflowSync";
import monzoBackfill from "./monzoBackfill";
import monzoPoll from "./monzoPoll";
import novelty from "./novelty";
import nudgeDispatch from "./nudgeDispatch";
import paydayDetect from "./paydayDetect";
import tokenWatch from "./tokenWatch";

export const jobs: JobDefinition[] = [
  monzoBackfill,
  monzoPoll,
  lunchflowSync,
  tokenWatch,
  categorise,
  detectRecurring,
  paydayDetect,
  impulseCheck,
  docIngest,
  expiryCheck,
  digest,
  nudgeDispatch,
  novelty,
  backup,
] as JobDefinition[];
