import { serve } from "inngest/node";
import { inngest } from "../src/workflows/client.mjs";
import { functions } from "../src/workflows/index.mjs";

export default serve({ client: inngest, functions });
