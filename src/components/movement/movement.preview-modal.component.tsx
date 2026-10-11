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
            case 'table': return 'Table';
            case 'enclosure': return 'Enclosure';
            case 'remarks': return '출타 특이사항';
        }
    };

    const currentHtmlContent = 
        activeTab === 'table' ? htmlContent :
        activeTab === 'enclosure' ? enclosureHtmlContent :
        remarksHtmlContent;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-4xl h-[92vh] max-h-[96vh] bg-white rounded-[2rem] p-6 sm:p-8 space-y-6 shadow-2xl flex flex-col">
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-black text-gray-900">출타 정보 생성 및 복사</h2>
                        <p className="text-xs sm:text-sm text-gray-400 mt-1 font-medium">MS Word 웹앱 붙여넣기 형식 미리보기입니다. 복사하여 사용하세요.</p>
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
                <div className="flex items-center justify-between border-b border-gray-200 shrink-0">
                    <div className="flex flex-1">
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
                </div>

                {/* Content Area - MS Word Web App Document Layout */}
                <div className="flex-1 border border-gray-200 rounded-2xl bg-white overflow-auto p-4 sm:p-6 flex justify-center">
                    <div 
                        className="w-fit max-w-full text-black flex flex-col items-start select-text mx-auto"
                        style={{
                            fontFamily: "Arial, 'Malgun Gothic', '맑은 고딕', sans-serif",
                            color: '#000000',
                            backgroundColor: '#ffffff'
                        }}
                        dangerouslySetInnerHTML={{ 
                            __html: DOMPurify.sanitize(currentHtmlContent, { 
                                ADD_ATTR: ['style', 'rowspan', 'colspan', 'align', 'border', 'width'] 
                            }) 
                        }} 
                    />
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
