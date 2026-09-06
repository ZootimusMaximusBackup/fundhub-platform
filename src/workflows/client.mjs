// Inngest client — Master Rebuild Spec §2/§6: the 140 CRM workflows become Inngest
// functions (durable steps, waits, branches), ~60 of which actually survive.
// One client for the whole platform; each workflow file in this directory registers
// exactly one function against it.
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "fundhub-platform" });
