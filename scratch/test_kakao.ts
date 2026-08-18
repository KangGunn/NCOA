import { getKakaoUnreturnedStatus, getKakaoRollCallStatus } from "../functions/src/services/kakao.service";
import { getKSTDateStr } from "../functions/src/utils/date.util";

async function runTest() {
    const todayStr = getKSTDateStr();
    console.log("=== Testing Kakao Roll Call Status ===");
    const rollcall = await getKakaoRollCallStatus(todayStr);
    console.log(JSON.stringify(rollcall, null, 2));

    console.log("\n=== Testing Kakao Unreturned Status ===");
    const unreturned = await getKakaoUnreturnedStatus(todayStr);
    console.log(JSON.stringify(unreturned, null, 2));
}

runTest().catch(console.error);
