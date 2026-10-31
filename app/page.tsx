import Workspace from './workspace';
import { getChatGPTUser } from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Home(){await getChatGPTUser();return <Workspace/>}
