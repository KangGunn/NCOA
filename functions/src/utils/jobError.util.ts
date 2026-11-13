/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 서버 처리(저장 요청·엑셀 반영) 오류를 사람이 읽을 수 있는 이유로 바꾸고,
 * 다시 시도하면 나아질 오류(일시 오류)인지, 사람이 고쳐야 하는 오류인지 나눈다.
 * 외부 의존성 없음 — tests/movement.job-error.test.ts
 */

/** 다시 시도해도 같은 결과가 나오는 오류 (사람이 시트·설정을 고쳐야 함) */
export class JobError extends Error {
    permanent = true;
    constructor(message: string) {
        super(message);
        this.name = "JobError";
    }
}

export interface ExplainedError {
    /** 화면에 보여 줄 이유와 할 일 */
    message: string;
    /** 원래 오류 문구 (확인용) */
    detail: string;
    /** true면 자동 재시도하지 않고 바로 실패로 둔다 */
    permanent: boolean;
}

export function explainError(err: any): ExplainedError {
    const detail = String(err?.response?.data?.error?.message || err?.message || err || "");
    const status = Number(err?.response?.status || err?.status || err?.code) || 0;
    const text = `${detail} ${err?.code || ""}`;

    if (err?.permanent) return { message: detail, detail, permanent: true };
    if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) {
        return { message: "구글 시트 요청 한도를 넘었습니다. 1~2분 뒤 다시 시도하세요.", detail, permanent: false };
    }
    if ([500, 502, 503, 504].includes(status) || /DEADLINE_EXCEEDED|UNAVAILABLE|ECONNRESET|ETIMEDOUT|socket hang up|timed? ?out/i.test(text)) {
        return { message: "구글 서버가 일시적으로 응답하지 않았습니다. 잠시 뒤 다시 시도하세요.", detail, permanent: false };
    }
    if (/maximum 500|too many (writes|operations)/i.test(text)) {
        return { message: "한 번에 반영할 기록이 너무 많습니다(500건 초과). 엑셀을 나눠서 올리세요.", detail, permanent: true };
    }
    if (/Unable to parse range|Requested entity was not found/i.test(text) || status === 404) {
        return { message: "스프레드시트 또는 'NEW' 탭을 찾을 수 없습니다. 시트 탭 이름과 설정의 시트 모드(테스트/운영)를 확인하세요.", detail, permanent: true };
    }
    if (status === 401 || /invalid_grant|UNAUTHENTICATED|credential/i.test(text)) {
        return { message: "서버 계정 인증에 실패했습니다. 서비스 계정 키를 확인하세요.", detail, permanent: true };
    }
    if (status === 403 || status === 7 || /PERMISSION_DENIED|permission|insufficient/i.test(text)) {
        return { message: "서버 계정에 접근 권한이 없습니다. 스프레드시트 공유(서비스 계정 편집 권한)를 확인하세요.", detail, permanent: true };
    }
    return { message: `알 수 없는 오류로 반영하지 못했습니다. (${detail || "내용 없음"})`, detail, permanent: false };
}
