import { X, Copy } from 'lucide-react';
import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';

interface MovementPreviewModalProps {
    htmlContent: string;
    plainTextContent: string;
    enclosureContent: string;
    enclosureHtmlContent: string;
    remarksContent: string;
    remarksHtmlContent: string;
    onClose: () => void;
}

type TabType = 'table' | 'enclosure' | 'remarks';

export function MovementPreviewModal({
    htmlContent,
    plainTextContent,
    enclosureContent,
    enclosureHtmlContent,
    remarksContent,
    remarksHtmlContent,
    onClose
}: MovementPreviewModalProps) {
    const [activeTab, setActiveTab] = useState<TabType>('table');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        // Lock body scroll
        const originalStyle = window.getComputedStyle(document.body).overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalStyle;
        };
    }, []);

    const handleCopy = async () => {
        try {
            if (activeTab === 'table') {
                const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
                const textBlob = new Blob([plainTextContent], { type: 'text/plain' });

                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': htmlBlob,
                        'text/plain': textBlob
                    })
                ]);
            } else if (activeTab === 'enclosure') {
                const htmlBlob = new Blob([enclosureHtmlContent], { type: 'text/html' });
                const textBlob = new Blob([enclosureContent], { type: 'text/plain' });

                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': htmlBlob,
                        'text/plain': textBlob
                    })
                ]);
            } else {
                const htmlBlob = new Blob([remarksHtmlContent], { type: 'text/html' });
                const textBlob = new Blob([remarksContent], { type: 'text/plain' });

                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': htmlBlob,
                        'text/plain': textBlob
                    })
                ]);
            }

            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Clipboard copy error:', err);
            alert('복사 실패: ' + err);
        }
    };

    const getTabLabel = (tab: TabType) => {
        switch (tab) {
            case 'table': return '패스지';
            case 'enclosure': return 'Enclosure';
            case 'remarks': return '출타 특이사항';
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-4xl h-[92vh] max-h-[96vh] bg-white rounded-[2rem] p-6 sm:p-8 space-y-6 shadow-2xl flex flex-col">
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-black text-gray-900">출타 정보 생성 및 복사</h2>
                        <p className="text-xs sm:text-sm text-gray-400 mt-1 font-medium">원하는 항목의 탭을 선택하고 복사하여 사용하세요.</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-full bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 shrink-0">
                    {(['table', 'enclosure', 'remarks'] as TabType[]).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => {
                                setActiveTab(tab);
                                setCopied(false);
                            }}
                            className={`flex-1 py-3 text-center text-sm font-bold border-b-2 transition-all ${
                                activeTab === tab
                                    ? 'border-blue-600 text-blue-600'
                                    : 'border-transparent text-gray-400 hover:text-gray-600'
                            }`}
                        >
                            {getTabLabel(tab)}
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div className="flex-1 flex flex-col border border-gray-200 rounded-2xl p-4 bg-gray-50 overflow-hidden">
                    {activeTab === 'table' && (
                        <div 
                            className="w-full h-full bg-white p-4 rounded-xl border border-gray-100 shadow-sm overflow-auto flex justify-center"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlContent) }} 
                        />
                    )}
                    {activeTab === 'enclosure' && (
                        <textarea
                            readOnly
                            value={enclosureContent}
                            placeholder="Enclosure 내용이 여기에 표시됩니다."
                            style={{ fontFamily: "Arial, 'Malgun Gothic', '맑은 고딕', sans-serif" }}
                            className="w-full h-full p-4 rounded-xl border border-gray-100 bg-white shadow-sm resize-none focus:outline-none text-sm text-gray-800"
                        />
                    )}
                    {activeTab === 'remarks' && (
                        <textarea
                            readOnly
                            value={remarksContent}
                            placeholder="출타 특이사항 내용이 여기에 표시됩니다."
                            style={{ fontFamily: "Arial, 'Malgun Gothic', '맑은 고딕', sans-serif" }}
                            className="w-full h-full p-4 rounded-xl border border-gray-100 bg-white shadow-sm resize-none focus:outline-none text-sm text-gray-800"
                        />
                    )}
                </div>

                {/* Buttons */}
                <div className="flex gap-3 shrink-0 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold transition-all"
                    >
                        닫기
                    </button>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="flex-[2] py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-2"
                    >
                        <Copy className="w-5 h-5" />
                        {copied ? '복사 완료!' : `${getTabLabel(activeTab)} 복사하기`}
                    </button>
                </div>
            </div>
        </div>
    );
}
