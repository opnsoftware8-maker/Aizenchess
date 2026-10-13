'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import {
  RotateCcw,
  ArrowUpDown,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Award,
  User,
  Bot,
  Play,
  Pause,
  SkipForward,
  ChevronRight,
  Shield,
  Swords,
  Info,
  SlidersHorizontal,
} from 'lucide-react';

type GameMode = 'pvai' | 'aivsai';
type PlayerColor = 'w' | 'b';
type PromotionPiece = 'q' | 'r' | 'b' | 'n';
type AiProvider = 'gemini' | 'openai' | 'deepseek';

interface PendingPromotion {
  from: Square;
  to: Square;
}

interface ProviderOption {
  id: AiProvider;
  name: string;
  tagline: string;
  model: string;
  badge: string;
  envKey: string;
}

const AI_PROVIDERS: ProviderOption[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    tagline: 'โมเดลความเร็วสูง ค่าเริ่มต้นพร้อมใช้งานฟรี',
    model: 'gemini-3.1-flash-lite',
    badge: 'ฟรี / แนะนำ',
    envKey: 'GEMINI_API_KEY',
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    tagline: 'โมเดล GPT-4o-mini วิเคราะห์กลยุทธ์เฉียบคม',
    model: 'gpt-4o-mini',
    badge: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tagline: 'โมเดล DeepSeek-Chat การคำนวณเชิงลึกชั้นนำ',
    model: 'deepseek-chat',
    badge: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
  },
];

interface AiLevelOption {
  id: string;
  name: string;
  level: string;
  model: string;
  desc: string;
}

const AI_LEVELS: AiLevelOption[] = [
  {
    id: 'beginner',
    name: 'เริ่มต้น',
    level: 'เริ่มต้น',
    model: 'gemini-3.1-flash-lite',
    desc: '3.1 Flash Lite - รวดเร็ว เหมาะสำหรับเริ่มต้น',
  },
  {
    id: 'medium',
    name: 'กลาง',
    level: 'กลาง',
    model: 'gemini-3.5-flash-lite',
    desc: '3.5 Flash Lite - สมดุลและฉับไว',
  },
  {
    id: 'medium-high',
    name: 'กลาง-สูงขึ้น',
    level: 'กลาง-สูงขึ้น',
    model: 'gemini-3.6-flash',
    desc: '3.6 Flash - วิเคราะห์เชิงลึก แม่นยำ',
  },
  {
    id: 'ultimate',
    name: 'สูงสุดเทพสุด',
    level: 'สูงสุดเทพสุด',
    model: 'gemini-3.7-flash',
    desc: '3.7 Flash - ระดับปรมาจารย์ สูงสุด',
  },
];

export default function ChessGame() {
  // chess.js instance as the single source of truth
  const gameRef = useRef<Chess>(new Chess());

  // UI state derived from gameRef
  const [fen, setFen] = useState<string>(() => gameRef.current.fen());
  const [history, setHistory] = useState<string[]>([]);
  const [gameMode, setGameMode] = useState<GameMode>('pvai');
  const [userColor, setUserColor] = useState<PlayerColor>('w');
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  const [gameStarted, setGameStarted] = useState<boolean>(false);

  // Setup modal state
  const [showSetupModal, setShowSetupModal] = useState<boolean>(true);
  const [modalStep, setModalStep] = useState<'mode' | 'customize' | 'pvai-color' | 'pvai-config' | 'aivsai-config'>('mode');
  const [pendingMode, setPendingMode] = useState<GameMode>('pvai');

  // AI model selection per side / mode
  const [whiteAiModel, setWhiteAiModel] = useState<string>('gemini-3.5-flash-lite');
  const [blackAiModel, setBlackAiModel] = useState<string>('gemini-3.6-flash');
  const [playerAiModel, setPlayerAiModel] = useState<string>('gemini-3.5-flash-lite');

  // Start new game
  const startNewGame = (mode: GameMode, color: PlayerColor = 'w') => {
    if (nextMoveTimerRef.current) {
      clearTimeout(nextMoveTimerRef.current);
      nextMoveTimerRef.current = null;
    }

    currentRequestIdRef.current += 1;
    isAiThinkingRef.current = false;

    const newGame = new Chess();
    gameRef.current = newGame;

    setGameMode(mode);
    setUserColor(color);
    setBoardOrientation(color === 'w' ? 'white' : 'black');
    setFen(newGame.fen());
    setHistory([]);
    setLastMove(null);
    setSelectedSquare(null);
    setAiError(null);
    setWhiteAiReason(null);
    setBlackAiReason(null);
    setPendingPromotion(null);
    setIsAiThinking(false);
    setIsAiVsAiPaused(false);
    setGameStarted(true);
    setShowSetupModal(false);
  };


  // Interaction state
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

  // AI reasoning state
  const [whiteAiReason, setWhiteAiReason] = useState<string | null>(null);
  const [blackAiReason, setBlackAiReason] = useState<string | null>(null);

  // AI vs AI specific controls
  const [isAiVsAiPaused, setIsAiVsAiPaused] = useState<boolean>(false);
  const [aiVsAiDelay, setAiVsAiDelay] = useState<number>(2000); // 2 seconds between moves

  const [whiteAiProvider, setWhiteAiProvider] = useState<AiProvider>('gemini');
  const [blackAiProvider, setBlackAiProvider] = useState<AiProvider>('gemini');
  const [playerAiOpponent, setPlayerAiOpponent] = useState<AiProvider>('gemini');

  // Ref tracking to prevent race conditions
  const isAiThinkingRef = useRef<boolean>(false);
  const currentRequestIdRef = useRef<number>(0);
  const nextMoveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  const currentTurn = gameRef.current.turn();
  const isGameOver = gameRef.current.isGameOver();
  const isUserTurn = gameMode === 'pvai' && currentTurn === userColor;

  // Auto scroll move history - Disabled to prevent unwanted page scrolling
  useEffect(() => {
    // historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Helper to find provider name
  const getProviderName = (provId: AiProvider) => {
    return AI_PROVIDERS.find((p) => p.id === provId)?.name || 'AI Engine';
  };

      // Request an AI move for a given side
  const requestAiMove = useCallback(
    async (currentFen: string, aiSide: PlayerColor) => {
      const currentGame = gameRef.current;
      if (currentGame.isGameOver() || currentGame.turn() !== aiSide) {
        return;
      }

      if (isAiThinkingRef.current) {
        return;
      }

      isAiThinkingRef.current = true;
      setIsAiThinking(true);
      setAiError(null);

      const requestId = ++currentRequestIdRef.current;

      const legalMoves = currentGame.moves({ verbose: true }).map((m) => ({
        from: m.from,
        to: m.to,
        promotion: m.promotion || null,
        san: m.san,
      }));

      try {
        let response: Response | null = null;
        let lastFetchErr: any = null;

        const chosenModel = aiSide === 'w' ? whiteAiModel : (gameMode === 'pvai' ? playerAiModel : blackAiModel);
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            response = await fetch('/api/ai-move', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fen: currentFen,
                aiColor: aiSide,
                legalMoves,
                model: chosenModel,
              }),
            });
            break;
          } catch (fErr: any) {
            lastFetchErr = fErr;
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 800));
            }
          }
        }

        if (!response) {
          throw new Error(
            lastFetchErr?.message === 'Failed to fetch' || lastFetchErr?.name === 'TypeError'
              ? 'การเชื่อมต่อไปยังเซิร์ฟเวอร์ขัดข้องชั่วคราว กรุณากดปุ่ม "ลองอีกครั้ง"'
              : lastFetchErr?.message || 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'
          );
        }

        const rawText = await response.text();
        let data: any = null;
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(
            `เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (${response.status}): ${
              rawText.length > 100 ? rawText.slice(0, 100) + '...' : rawText || 'ไม่มีข้อมูลตอบกลับ'
            }`
          );
        }

        // Ignore stale responses
        if (requestId !== currentRequestIdRef.current) {
          return;
        }

        // Confirm board position has not drifted
        if (gameRef.current.fen() !== currentFen || gameRef.current.turn() !== aiSide) {
          return;
        }

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'ไม่สามารถรับตาเดินจาก AI ได้');
        }

        // Validate & apply AI move strictly via chess.js
        let moveResult = null;
        try {
          moveResult = gameRef.current.move({
            from: data.move.from,
            to: data.move.to,
            promotion: data.move.promotion || undefined,
          });
        } catch (moveErr) {
          console.warn('AI Move validation error on client:', moveErr);
        }

        if (!moveResult) {
          throw new Error('หมากที่ AI เลือกไม่สามารถเดินได้ในตำแหน่งนี้');
        }

        // Update state strictly from chess.js
        const nextFen = gameRef.current.fen();
        setFen(nextFen);
        setHistory(gameRef.current.history());
        setLastMove({ from: data.move.from, to: data.move.to });

        // Save reasoning per side
        if (data.move.reason) {
          if (aiSide === 'w') {
            setWhiteAiReason(data.move.reason);
          } else {
            setBlackAiReason(data.move.reason);
          }
        }
      } catch (err: any) {
        if (requestId === currentRequestIdRef.current) {
          console.error('AI Move Error:', err);
          setAiError(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI');
        }
      } finally {
        if (requestId === currentRequestIdRef.current) {
          isAiThinkingRef.current = false;
          setIsAiThinking(false);
        }
      }
    },
    [gameMode, whiteAiModel, blackAiModel, playerAiModel]
  );

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (nextMoveTimerRef.current) {
        clearTimeout(nextMoveTimerRef.current);
      }
    };
  }, []);

  // Main turn loop orchestrator
  useEffect(() => {
    if (!gameStarted || isGameOver) return;

    if (nextMoveTimerRef.current) {
      clearTimeout(nextMoveTimerRef.current);
      nextMoveTimerRef.current = null;
    }

    // 1. Mode: Player vs AI
    if (gameMode === 'pvai') {
      const aiColor: PlayerColor = userColor === 'w' ? 'b' : 'w';
      if (gameRef.current.turn() === aiColor && !isAiThinking && !aiError) {
        requestAiMove(gameRef.current.fen(), aiColor);
      }
      return;
    }

    // 2. Mode: AI vs AI
    if (gameMode === 'aivsai') {
      if (isAiVsAiPaused || isAiThinking || aiError) {
        return;
      }

      const turn = gameRef.current.turn();
      nextMoveTimerRef.current = setTimeout(() => {
        if (!isAiVsAiPaused && gameStarted && !gameRef.current.isGameOver()) {
          requestAiMove(gameRef.current.fen(), turn);
        }
      }, aiVsAiDelay);
    }
  }, [
    fen,
    gameStarted,
    isGameOver,
    gameMode,
    userColor,
    isAiThinking,
    aiError,
    isAiVsAiPaused,
    aiVsAiDelay,
    requestAiMove,
  ]);



  // Step manually in AI vs AI mode when paused
  const handleStepAiVsAi = () => {
    if (gameMode !== 'aivsai' || isAiThinking || isGameOver) return;
    const turn = gameRef.current.turn();
    requestAiMove(gameRef.current.fen(), turn);
  };

  // Player move execution
  const executePlayerMove = (from: Square, to: Square, promotion?: PromotionPiece): boolean => {
    if (gameMode !== 'pvai' || isAiThinkingRef.current) return false;
    currentRequestIdRef.current += 1;

    try {
      const move = gameRef.current.move({
        from,
        to,
        promotion: promotion || undefined,
      });

      if (!move) return false;

      setFen(gameRef.current.fen());
      setHistory(gameRef.current.history());
      setLastMove({ from, to });
      setSelectedSquare(null);
      setAiError(null);
      return true;
    } catch {
      return false;
    }
  };

  const isPawnPromotion = (from: Square, to: Square): boolean => {
    const piece = gameRef.current.get(from);
    if (!piece || piece.type !== 'p') return false;

    return (
      (piece.color === 'w' && to.endsWith('8')) ||
      (piece.color === 'b' && to.endsWith('1'))
    );
  };

  const handlePieceDrop = ({
    sourceSquare,
    targetSquare,
  }: {
    piece: any;
    sourceSquare: string;
    targetSquare: string | null;
  }): boolean => {
    if (gameMode !== 'pvai') return false;
    if (!targetSquare || isAiThinking || isGameOver || !isUserTurn) {
      return false;
    }

    const from = sourceSquare as Square;
    const to = targetSquare as Square;

    const piece = gameRef.current.get(from);
    if (!piece || piece.color !== userColor) {
      return false;
    }

    const legalMoves = gameRef.current.moves({ square: from, verbose: true });
    const isLegalTarget = legalMoves.some((m) => m.to === to);
    if (!isLegalTarget) {
      return false;
    }

    if (isPawnPromotion(from, to)) {
      setPendingPromotion({ from, to });
      return false;
    }

    return executePlayerMove(from, to);
  };

  const handleSquareClick = ({ square }: { piece: any; square: string }) => {
    if (gameMode !== 'pvai') return;
    if (isAiThinking || isGameOver || !isUserTurn) return;

    const sq = square as Square;
    const clickedPiece = gameRef.current.get(sq);

    if (selectedSquare) {
      if (selectedSquare === sq) {
        setSelectedSquare(null);
        return;
      }

      if (clickedPiece && clickedPiece.color === userColor) {
        setSelectedSquare(sq);
        return;
      }

      const legalMoves = gameRef.current.moves({
        square: selectedSquare,
        verbose: true,
      });
      const targetMove = legalMoves.find((m) => m.to === sq);

      if (targetMove) {
        if (isPawnPromotion(selectedSquare, sq)) {
          setPendingPromotion({ from: selectedSquare, to: sq });
          return;
        }

        executePlayerMove(selectedSquare, sq);
        return;
      }

      setSelectedSquare(null);
      return;
    }

    if (clickedPiece && clickedPiece.color === userColor) {
      setSelectedSquare(sq);
    }
  };

  const handlePromotionSelect = (piece: PromotionPiece) => {
    if (!pendingPromotion) return;
    executePlayerMove(pendingPromotion.from, pendingPromotion.to, piece);
    setPendingPromotion(null);
  };

  // Custom highlights on board
  const getCustomSquareStyles = (): Record<string, React.CSSProperties> => {
    const styles: Record<string, React.CSSProperties> = {};

    if (lastMove) {
      styles[lastMove.from] = {
        backgroundColor: 'rgba(234, 179, 8, 0.28)',
      };
      styles[lastMove.to] = {
        backgroundColor: 'rgba(234, 179, 8, 0.28)',
      };
    }

    if (selectedSquare && gameMode === 'pvai') {
      styles[selectedSquare] = {
        boxShadow: 'inset 0 0 0 3px #3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.22)',
      };

      const moves = gameRef.current.moves({
        square: selectedSquare,
        verbose: true,
      });

      for (const m of moves) {
        const destPiece = gameRef.current.get(m.to as Square);
        const isCapture = Boolean(destPiece || m.captured);

        if (isCapture) {
          styles[m.to] = {
            background:
              'radial-gradient(circle, transparent 52%, #ef4444 54%, #ef4444 72%, transparent 74%)',
            cursor: 'pointer',
          };
        } else {
          styles[m.to] = {
            background:
              'radial-gradient(circle, #22c55e 25%, transparent 26%)',
            cursor: 'pointer',
          };
        }
      }
    }

    if (gameRef.current.inCheck()) {
      const turn = gameRef.current.turn();
      const board = gameRef.current.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = board[r][c];
          if (p && p.type === 'k' && p.color === turn) {
            const file = String.fromCharCode('a'.charCodeAt(0) + c);
            const rank = (8 - r).toString();
            const kingSquare = `${file}${rank}`;
            styles[kingSquare] = {
              backgroundColor: 'rgba(239, 68, 68, 0.45)',
              boxShadow: 'inset 0 0 0 3px #ef4444',
            };
          }
        }
      }
    }

    return styles;
  };

  const getGameStatusText = () => {
    if (gameRef.current.isCheckmate()) {
      const winner = gameRef.current.turn() === 'w' ? 'ดำ' : 'ขาว';
      return `รุกจน — ฝ่าย${winner} ชนะ!`;
    }
    if (gameRef.current.isDraw()) {
      return 'เสมอ (Draw)';
    }
    if (gameRef.current.inCheck()) {
      return `รุก! (ตาของฝ่าย${currentTurn === 'w' ? 'ขาว' : 'ดำ'})`;
    }
    if (isAiThinking) {
      if (gameMode === 'aivsai') {
        const prov = currentTurn === 'w' ? whiteAiProvider : blackAiProvider;
        return `${getProviderName(prov)} (ฝ่าย${currentTurn === 'w' ? 'ขาว' : 'ดำ'}) กำลังคิด...`;
      }
      return `${getProviderName(playerAiOpponent)} กำลังคิด...`;
    }
    if (gameMode === 'aivsai') {
      if (isAiVsAiPaused) {
        return `หยุดชั่วคราว (ตาฝ่าย${currentTurn === 'w' ? 'ขาว' : 'ดำ'})`;
      }
      return `กำลังแข่งขัน (ตาฝ่าย${currentTurn === 'w' ? 'ขาว' : 'ดำ'})`;
    }
    if (isUserTurn) {
      return 'ตาของคุณ';
    }
    return `ตาของ AI (${getProviderName(playerAiOpponent)})`;
  };

  // Group move history in pairs
  const movePairs: { num: number; white: string; black?: string }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    movePairs.push({
      num: Math.floor(i / 2) + 1,
      white: history[i],
      black: history[i + 1],
    });
  }

  return (
    <div className="min-h-screen bg-[#111216] text-[#e6e8ec] flex flex-col font-sans select-none">
      {/* Header Bar */}
      <header className="border-b border-[#242834] bg-[#161820] px-4 py-3 sm:px-6 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-1.5">
                  <span>Chess AI Battle</span>
                </h1>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30">
                  {gameMode === 'pvai' ? 'ผู้เล่น vs AI' : 'AI vs AI'}
                </span>
              </div>
              <p className="text-xs text-neutral-400 hidden sm:block">
                {gameMode === 'pvai'
                  ? `ประลองหมากรุกกับ ${getProviderName(playerAiOpponent)}`
                  : `การแข่งขัน: ${getProviderName(whiteAiProvider)} (ขาว) vs ${getProviderName(blackAiProvider)} (ดำ)`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setBoardOrientation((prev) => (prev === 'white' ? 'black' : 'white'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-[#222632] hover:bg-[#2b3040] text-neutral-200 border border-[#313748] transition-colors cursor-pointer"
              title="กลับด้านมุมมองกระดาน"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">กลับด้านกระดาน</span>
            </button>

            <button
              onClick={() => {
                setModalStep('mode');
                setShowSetupModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-[#2563eb] hover:bg-[#1d4ed8] text-white transition-colors cursor-pointer shadow-sm"
              title="ตั้งค่าโมเดล AI หรือเริ่มเกมใหม่"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>เริ่มเกม / ตั้งค่า</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 flex flex-col lg:flex-row gap-6 items-center lg:items-start justify-center">
        {/* Board Section */}
        <div className="flex flex-col items-center w-full max-w-[500px] sm:max-w-[540px]">
          {/* Top Player / AI Info Bar */}
          <div className="w-full flex items-center justify-between py-2.5 px-3.5 mb-2 rounded-xl bg-[#181a22] border border-[#262a36]">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-3.5 h-3.5 rounded-full shadow-xs ${
                  (boardOrientation === 'white' ? 'b' : 'w') === 'w'
                    ? 'bg-neutral-100'
                    : 'bg-neutral-900 border border-neutral-600'
                }`}
              />
              <span className="text-sm font-medium text-neutral-200 flex items-center gap-1.5">
                {gameMode === 'aivsai' ? (
                  <>
                    <Bot className="w-4 h-4 text-purple-400" />
                    <span>
                      {boardOrientation === 'white'
                        ? `${getProviderName(blackAiProvider)} (ดำ)`
                        : `${getProviderName(whiteAiProvider)} (ขาว)`}
                    </span>
                  </>
                ) : userColor === 'w' ? (
                  <>
                    <Bot className="w-4 h-4 text-purple-400" />
                    <span>{getProviderName(playerAiOpponent)} (ฝ่ายดำ)</span>
                  </>
                ) : (
                  <>
                    <User className="w-4 h-4 text-blue-400" />
                    <span>คุณ (ฝ่ายขาว)</span>
                  </>
                )}
              </span>
            </div>

            {currentTurn === (boardOrientation === 'white' ? 'b' : 'w') && !isGameOver && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                {isAiThinking ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>กำลังคิด...</span>
                  </>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/30">
                    ถึงตาเดิน
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Chessboard Box */}
          <div className="w-full aspect-square relative rounded-xl overflow-hidden shadow-2xl border border-[#2e3342] bg-[#1a1d26]">
            <Chessboard
              options={{
                position: fen,
                boardOrientation,
                onPieceDrop: handlePieceDrop,
                onSquareClick: handleSquareClick,
                canDragPiece: ({ piece }) =>
                  gameMode === 'pvai' &&
                  piece.pieceType.startsWith(userColor) &&
                  !isAiThinking &&
                  !isGameOver,
                squareStyles: getCustomSquareStyles(),
                darkSquareStyle: { backgroundColor: '#b58863' },
                lightSquareStyle: { backgroundColor: '#f0d9b5' },
                boardStyle: {
                  borderRadius: '12px',
                },
                animationDurationInMs: 250,
              }}
            />

            {/* Pawn Promotion Dialog (for Player vs AI mode) */}
            {pendingPromotion && (
              <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-30">
                <div className="bg-[#1e222d] border border-[#363c4e] rounded-xl p-5 max-w-xs w-full text-center shadow-2xl">
                  <h3 className="text-base font-semibold text-white mb-1">
                    เลื่อนขั้นเบี้ย (Pawn Promotion)
                  </h3>
                  <p className="text-xs text-neutral-400 mb-4">เลือกตัวหมากที่ต้องการเลื่อนขั้น</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      onClick={() => handlePromotionSelect('q')}
                      className="py-2.5 px-3 rounded-lg bg-[#272c3b] hover:bg-[#343b4f] text-white text-sm font-medium border border-[#3b4359] transition-colors cursor-pointer"
                    >
                      ควีน (Queen)
                    </button>
                    <button
                      onClick={() => handlePromotionSelect('r')}
                      className="py-2.5 px-3 rounded-lg bg-[#272c3b] hover:bg-[#343b4f] text-white text-sm font-medium border border-[#3b4359] transition-colors cursor-pointer"
                    >
                      เรือ (Rook)
                    </button>
                    <button
                      onClick={() => handlePromotionSelect('b')}
                      className="py-2.5 px-3 rounded-lg bg-[#272c3b] hover:bg-[#343b4f] text-white text-sm font-medium border border-[#3b4359] transition-colors cursor-pointer"
                    >
                      บิชอป (Bishop)
                    </button>
                    <button
                      onClick={() => handlePromotionSelect('n')}
                      className="py-2.5 px-3 rounded-lg bg-[#272c3b] hover:bg-[#343b4f] text-white text-sm font-medium border border-[#3b4359] transition-colors cursor-pointer"
                    >
                      ม้า (Knight)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Player / AI Info Bar */}
          <div className="w-full flex items-center justify-between py-2.5 px-3.5 mt-2 rounded-xl bg-[#181a22] border border-[#262a36]">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-3.5 h-3.5 rounded-full shadow-xs ${
                  (boardOrientation === 'white' ? 'w' : 'b') === 'w'
                    ? 'bg-neutral-100'
                    : 'bg-neutral-900 border border-neutral-600'
                }`}
              />
              <span className="text-sm font-medium text-neutral-200 flex items-center gap-1.5">
                {gameMode === 'aivsai' ? (
                  <>
                    <Bot className="w-4 h-4 text-purple-400" />
                    <span>
                      {boardOrientation === 'white'
                        ? `${getProviderName(whiteAiProvider)} (ขาว)`
                        : `${getProviderName(blackAiProvider)} (ดำ)`}
                    </span>
                  </>
                ) : userColor === 'w' ? (
                  <>
                    <User className="w-4 h-4 text-blue-400" />
                    <span>คุณ (ฝ่ายขาว)</span>
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4 text-purple-400" />
                    <span>{getProviderName(playerAiOpponent)} (ฝ่ายขาว)</span>
                  </>
                )}
              </span>
            </div>

            {currentTurn === (boardOrientation === 'white' ? 'w' : 'b') && !isGameOver && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                {isAiThinking ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>กำลังคิด...</span>
                  </>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30">
                    ถึงตาเดิน
                  </span>
                )}
              </div>
            )}
          </div>

          {/* AI vs AI Spectator Controls Toolbar */}
          {gameMode === 'aivsai' && (
            <div className="w-full mt-3 p-3 rounded-xl bg-[#181a22] border border-[#2e3342] flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsAiVsAiPaused((prev) => !prev)}
                  disabled={isGameOver}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isAiVsAiPaused
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  {isAiVsAiPaused ? (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>เล่นต่อ</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5 fill-current" />
                      <span>หยุดชั่วคราว</span>
                    </>
                  )}
                </button>

                {isAiVsAiPaused && !isGameOver && (
                  <button
                    onClick={handleStepAiVsAi}
                    disabled={isAiThinking}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#272c3b] hover:bg-[#343b4f] text-neutral-200 border border-[#3b4359] transition-colors cursor-pointer"
                    title="สั่งให้ AI เดิน 1 ตา"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>เดินทีละตา</span>
                  </button>
                )}
              </div>

              {/* Speed Preset Selector */}
              <div className="flex items-center gap-1 text-xs">
                <span className="text-neutral-400 text-[11px] mr-1 hidden sm:inline">ความเร็ว:</span>
                <button
                  onClick={() => setAiVsAiDelay(3000)}
                  className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                    aiVsAiDelay === 3000
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'bg-[#222632] text-neutral-400 hover:text-white'
                  }`}
                >
                  ช้า (3s)
                </button>
                <button
                  onClick={() => setAiVsAiDelay(2000)}
                  className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                    aiVsAiDelay === 2000
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'bg-[#222632] text-neutral-400 hover:text-white'
                  }`}
                >
                  ปกติ (2s)
                </button>
                <button
                  onClick={() => setAiVsAiDelay(1200)}
                  className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                    aiVsAiDelay === 1200
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'bg-[#222632] text-neutral-400 hover:text-white'
                  }`}
                >
                  เร็ว (1.2s)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Section: Status, AI Reasoning & Move History */}
        <div className="w-full lg:w-80 flex flex-col gap-4">
          {/* Game Status Card */}
          <div className="bg-[#181a22] rounded-xl border border-[#262a36] p-4 shadow-md">
            <div className="text-xs font-medium text-neutral-400 mb-1 flex items-center justify-between">
              <span>สถานะการแข่งขัน</span>
              <span className="font-mono text-[11px] text-neutral-500">
                ตาที่ {Math.floor(history.length / 2) + 1}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                {isGameOver ? (
                  <Award className="w-5 h-5 text-amber-400" />
                ) : (
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      isAiThinking
                        ? 'bg-amber-400 animate-ping'
                        : isUserTurn
                        ? 'bg-emerald-400'
                        : 'bg-blue-400'
                    }`}
                  />
                )}
                <span>{getGameStatusText()}</span>
              </div>
            </div>

            {/* Error Banner with Retry & Quick Switch */}
            {aiError && (
              <div className="mt-3 p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex flex-col gap-2">
                <div className="flex items-start gap-1.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{aiError}</span>
                </div>
                <div className="flex items-center justify-end gap-2 mt-1">
                  {aiError.includes('API_KEY') && (
                    <button
                      onClick={() => {
                        setWhiteAiProvider('gemini');
                        setBlackAiProvider('gemini');
                        setPlayerAiOpponent('gemini');
                        setAiError(null);
                        requestAiMove(gameRef.current.fen(), currentTurn);
                      }}
                      className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors cursor-pointer"
                    >
                      สลับใช้ Gemini แทน
                    </button>
                  )}
                  <button
                    onClick={() => requestAiMove(gameRef.current.fen(), currentTurn)}
                    disabled={isAiThinking}
                    className="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors cursor-pointer"
                  >
                    ลองอีกครั้ง
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* AI Reasoning Panel */}
          {gameMode === 'aivsai' ? (
            // Dual AI Reasoning Panel for AI vs AI mode
            <div className="bg-[#181a22] rounded-xl border border-[#262a36] p-4 shadow-md flex flex-col gap-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>การวิเคราะห์กลยุทธ์ของ AI</span>
              </div>

              {/* White AI Card */}
              <div className="p-2.5 rounded-lg bg-[#202430] border border-[#2e3444] text-xs">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-semibold text-neutral-100">
                    <span className="w-2.5 h-2.5 rounded-full bg-neutral-100 inline-block" />
                    <span>AI ขาว ({getProviderName(whiteAiProvider)}):</span>
                  </div>
                  {currentTurn === 'w' && isAiThinking && (
                    <span className="text-[11px] text-amber-400 animate-pulse">กำลังคำนวณ...</span>
                  )}
                </div>
                <p className="text-neutral-300 italic text-[11px] leading-relaxed">
                  {whiteAiReason || 'รอตาเดินแรกของฝ่ายขาว...'}
                </p>
              </div>

              {/* Black AI Card */}
              <div className="p-2.5 rounded-lg bg-[#202430] border border-[#2e3444] text-xs">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-semibold text-neutral-100">
                    <span className="w-2.5 h-2.5 rounded-full bg-neutral-900 border border-neutral-500 inline-block" />
                    <span>AI ดำ ({getProviderName(blackAiProvider)}):</span>
                  </div>
                  {currentTurn === 'b' && isAiThinking && (
                    <span className="text-[11px] text-amber-400 animate-pulse">กำลังคำนวณ...</span>
                  )}
                </div>
                <p className="text-neutral-300 italic text-[11px] leading-relaxed">
                  {blackAiReason || 'รอตาเดินของฝ่ายดำ...'}
                </p>
              </div>
            </div>
          ) : (
            // Single AI Reasoning Box for Player vs AI mode
            (whiteAiReason || blackAiReason) &&
            !aiError && (
              <div className="bg-[#181a22] rounded-xl border border-[#262a36] p-3.5 shadow-md">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300 mb-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>ความคิดของ {getProviderName(playerAiOpponent)}:</span>
                </div>
                <p className="text-xs text-neutral-300 italic leading-relaxed">
                  {userColor === 'w' ? blackAiReason : whiteAiReason}
                </p>
              </div>
            )
          )}

          {/* Move History Panel */}
          <div className="bg-[#181a22] rounded-xl border border-[#262a36] p-4 shadow-md flex flex-col flex-1 min-h-[220px] max-h-[340px]">
            <div className="flex items-center justify-between border-b border-[#262a36] pb-2 mb-2">
              <h2 className="text-sm font-semibold text-neutral-200">ประวัติการเดิน (Move History)</h2>
              <span className="text-xs text-neutral-500">{history.length} ตาเดิน</span>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 text-sm space-y-1">
              {movePairs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-neutral-500 italic py-8">
                  ยังไม่มีการเดินหมาก
                </div>
              ) : (
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="text-neutral-500 border-b border-[#222632]">
                      <th className="py-1 w-10 font-medium">#</th>
                      <th className="py-1 font-medium">ขาว</th>
                      <th className="py-1 font-medium">ดำ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movePairs.map((pair) => (
                      <tr
                        key={pair.num}
                        className="border-b border-[#1f222d] hover:bg-[#1f232f] transition-colors"
                      >
                        <td className="py-1 text-neutral-500 font-mono">{pair.num}.</td>
                        <td className="py-1 text-neutral-200 font-mono font-medium">
                          {pair.white}
                        </td>
                        <td className="py-1 text-neutral-400 font-mono font-medium">
                          {pair.black || ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div ref={historyEndRef} />
            </div>
          </div>
        </div>
      </main>

      {/* Start / Mode Selection Modal */}
      {showSetupModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-[#181a22] border border-[#2f3547] rounded-2xl p-5 sm:p-6 max-w-md w-full text-center shadow-2xl my-6">
            {modalStep === 'pvai-config' ? (
              <div className="text-left">
                <h2 className="text-lg sm:text-xl font-bold text-white mb-1 text-center">เลือกระดับความสามารถ AI</h2>
                <p className="text-xs text-neutral-400 mb-4 text-center">เลือกโมเดล Gemini สำหรับคู่ต่อสู้ของคุณ</p>
                <div className="space-y-2 mb-4 max-h-[260px] overflow-y-auto pr-1">
                  {AI_LEVELS.map((lvl) => (
                    <button
                      key={lvl.model}
                      type="button"
                      onClick={() => setPlayerAiModel(lvl.model)}
                      className={`w-full p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                        playerAiModel === lvl.model
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-[#222632] border-[#313748] text-neutral-300 hover:bg-[#2b3040]'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-semibold text-white">{lvl.name}</div>
                        <div className="text-[11px] text-neutral-400">{lvl.desc}</div>
                      </div>
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${playerAiModel === lvl.model ? 'border-blue-400 bg-blue-500' : 'border-neutral-500'}`}>
                        {playerAiModel === lvl.model && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setModalStep('mode')}
                    className="w-1/3 py-2 rounded-lg bg-[#222632] hover:bg-[#2b3040] text-xs text-neutral-300 transition-colors cursor-pointer"
                  >
                    ย้อนกลับ
                  </button>
                  <button
                    onClick={() => setModalStep('pvai-color')}
                    className="w-2/3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white font-semibold transition-colors cursor-pointer"
                  >
                    ถัดไป (เลือกสี) →
                  </button>
                </div>
              </div>
            ) : modalStep === 'pvai-color' ? (
              <div className="text-left">
                <h2 className="text-lg sm:text-xl font-bold text-white mb-1 text-center">เลือกสีของคุณ</h2>
                <p className="text-xs text-neutral-400 mb-5 text-center">ฝ่ายขาวจะได้เดินก่อนเสมอ</p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <button
                    type="button"
                    onClick={() => startNewGame('pvai', 'w')}
                    className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#222632] hover:bg-[#2b3040] border-2 border-transparent hover:border-blue-500 transition-all cursor-pointer group"
                  >
                    <div className="text-lg mb-0.5">♔ ฝ่ายขาว</div>
                    <div className="text-[11px] text-neutral-400">คุณเดินก่อน</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => startNewGame('pvai', 'b')}
                    className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#222632] hover:bg-[#2b3040] border-2 border-transparent hover:border-blue-500 transition-all cursor-pointer group"
                  >
                    <div className="text-lg mb-0.5">♚ ฝ่ายดำ</div>
                    <div className="text-[11px] text-neutral-400">AI เดินก่อน</div>
                  </button>
                </div>
                <button
                  onClick={() => setModalStep('pvai-config')}
                  className="w-full text-xs text-neutral-400 hover:text-white underline transition-colors cursor-pointer text-center"
                >
                  ← ย้อนกลับ (เลือกระดับ AI)
                </button>
              </div>
            ) : modalStep === 'aivsai-config' ? (
              <div className="text-left">
                <h2 className="text-lg sm:text-xl font-bold text-white mb-1 text-center">ตั้งค่า AI vs AI</h2>
                <p className="text-xs text-neutral-400 mb-4 text-center">เลือกระดับความสามารถของ AI ทั้งสองฝ่าย</p>
                
                <div className="space-y-4 mb-4 max-h-[300px] overflow-y-auto pr-1">
                  <div>
                    <label className="text-xs font-semibold text-neutral-300 block mb-1.5 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-neutral-100 inline-block" />
                      <span>AI ฝ่ายขาว (White AI Level):</span>
                    </label>
                    <select
                      value={whiteAiModel}
                      onChange={(e) => setWhiteAiModel(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-[#222632] border border-[#313748] text-white text-xs focus:outline-none focus:border-purple-500"
                    >
                      {AI_LEVELS.map((lvl) => (
                        <option key={lvl.model} value={lvl.model}>
                          {lvl.name} ({lvl.desc})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-neutral-300 block mb-1.5 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-neutral-900 border border-neutral-500 inline-block" />
                      <span>AI ฝ่ายดำ (Black AI Level):</span>
                    </label>
                    <select
                      value={blackAiModel}
                      onChange={(e) => setBlackAiModel(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-[#222632] border border-[#313748] text-white text-xs focus:outline-none focus:border-purple-500"
                    >
                      {AI_LEVELS.map((lvl) => (
                        <option key={lvl.model} value={lvl.model}>
                          {lvl.name} ({lvl.desc})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setModalStep('mode')}
                    className="w-1/3 py-2 rounded-lg bg-[#222632] hover:bg-[#2b3040] text-xs text-neutral-300 transition-colors cursor-pointer"
                  >
                    ย้อนกลับ
                  </button>
                  <button
                    onClick={() => startNewGame('aivsai', 'w')}
                    className="w-2/3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs text-white font-semibold transition-colors cursor-pointer"
                  >
                    เริ่มการแข่งขัน AI vs AI ⚔️
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
                  <Shield className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-white mb-1">เลือกโหมดการเล่น</h2>
                <p className="text-xs text-neutral-400 mb-5">
                  เลือกรูปแบบการแข่งขันหมากรุกที่คุณต้องการ
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {/* Option 1: Player vs AI */}
                  <button
                    onClick={() => setModalStep('pvai-config')}
                    className="flex flex-col items-center justify-between p-4 rounded-xl bg-[#222632] hover:bg-[#2b3040] border-2 border-transparent hover:border-blue-500 transition-all cursor-pointer group text-left"
                  >
                    <div className="w-12 h-12 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                      <User className="w-6 h-6" />
                    </div>
                    <div className="text-center">
                      <h3 className="text-sm font-bold text-white mb-0.5">เล่นกับ AI</h3>
                      <p className="text-[11px] text-neutral-400 leading-tight">
                        เลือกระดับความสามารถแล้วประลองกัน
                      </p>
                    </div>
                    <span className="mt-3 text-xs text-blue-400 font-semibold inline-flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                      เลือกระดับ AI <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </button>

                  {/* Option 2: AI vs AI */}
                  <button
                    onClick={() => setModalStep('aivsai-config')}
                    className="flex flex-col items-center justify-between p-4 rounded-xl bg-[#222632] hover:bg-[#2b3040] border-2 border-transparent hover:border-purple-500 transition-all cursor-pointer group text-left"
                  >
                    <div className="w-12 h-12 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                      <Swords className="w-6 h-6" />
                    </div>
                    <div className="text-center">
                      <h3 className="text-sm font-bold text-white mb-0.5">AI vs AI</h3>
                      <p className="text-[11px] text-neutral-400 leading-tight">
                        เลือก AI 2 ตัวมาแข่งขันกันเอง
                      </p>
                    </div>
                    <span className="mt-3 text-xs text-purple-400 font-semibold inline-flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                      ตั้งค่า AI คู่แข่ง <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </button>
                </div>

                {gameStarted && (
                  <button
                    onClick={() => setShowSetupModal(false)}
                    className="text-xs text-neutral-400 hover:text-white underline transition-colors cursor-pointer"
                  >
                    กลับไปที่เกมปัจจุบัน
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
