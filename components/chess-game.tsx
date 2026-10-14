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
  User,
  Bot,
  Play,
  Pause,
  SkipForward,
  ChevronRight,
  Shield,
  Swords,
  Info,
  Key,
  Check,
  ExternalLink,
  ShieldCheck,
  Trash2,
  Eye,
  EyeOff,
  Sparkle,
} from 'lucide-react';

type GameMode = 'pvai' | 'aivsai';
type PlayerColor = 'w' | 'b';
type PromotionPiece = 'q' | 'r' | 'b' | 'n';

interface PendingPromotion {
  from: Square;
  to: Square;
}

interface AiLevelOption {
  id: string;
  name: string;
  level: string;
  model: string;
  desc: string;
}

const AI_LEVELS: AiLevelOption[] = [
  {
    id: 'flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    level: 'เริ่มต้น',
    model: 'gemini-3.1-flash-lite',
    desc: 'รวดเร็ว ตอบสนองไว ใช้ทรัพยากรน้อย เหมาะกับการฝึกซ้อม',
  },
  {
    id: 'flash-latest',
    name: 'Gemini Flash Latest (แนะนำ)',
    level: 'ระดับกลาง',
    model: 'gemini-flash-latest',
    desc: 'ขุมพลังสมดุล คำนวณหมากรัดกุม แม่นยำ และตอบสนองไว',
  },
  {
    id: 'flash-3.8',
    name: 'Gemini 3.8 Flash',
    level: 'มาตรฐาน',
    model: 'gemini-3.8-flash',
    desc: 'โมเดล Flash เจเนอเรชันใหม่ ปรับปรุงการวางหมากยุทธวิธี',
  },
  {
    id: 'pro-3.1',
    name: 'Gemini 3.1 Pro Preview',
    level: 'ระดับสูง',
    model: 'gemini-3.1-pro-preview',
    desc: 'ขุมพลังเรือธง วิเคราะห์เชิงลึก คำนวณหมากซับซ้อนหลายตาเดิน',
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

  // User Custom API Key state (saved in localStorage)
  const [customApiKey, setCustomApiKey] = useState<string>('');
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [inputApiKey, setInputApiKey] = useState<string>('');
  const [showKeyText, setShowKeyText] = useState<boolean>(false);
  const [testKeyStatus, setTestKeyStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testKeyMessage, setTestKeyMessage] = useState<string>('');

  // Setup modal state
  const [showSetupModal, setShowSetupModal] = useState<boolean>(true);
  const [modalStep, setModalStep] = useState<'mode' | 'pvai-config' | 'pvai-color' | 'aivsai-config'>('mode');

  const [whiteAiModel, setWhiteAiModel] = useState<string>('gemini-flash-latest');
  const [blackAiModel, setBlackAiModel] = useState<string>('gemini-flash-latest');
  const [playerAiModel, setPlayerAiModel] = useState<string>('gemini-flash-latest');

  // Interaction state
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

  // AI reasoning state
  const [whiteAiReason, setWhiteAiReason] = useState<string | null>(null);
  const [blackAiReason, setBlackAiReason] = useState<string | null>(null);
  const [usedCustomKeyForLastMove, setUsedCustomKeyForLastMove] = useState<boolean>(false);

  // AI vs AI specific controls
  const [isAiVsAiPaused, setIsAiVsAiPaused] = useState<boolean>(false);
  const [aiVsAiDelay, setAiVsAiDelay] = useState<number>(1800); // 1.8 seconds between moves

  // Ref tracking to prevent race conditions
  const isAiThinkingRef = useRef<boolean>(false);
  const currentRequestIdRef = useRef<number>(0);
  const nextMoveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  // Board width measurement for react-chessboard
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState<number>(460);
  const [isMounted, setIsMounted] = useState<boolean>(false);

  // Load custom API key from localStorage on mount & set mounted flag
  useEffect(() => {
    setIsMounted(true);
    try {
      const stored = localStorage.getItem('chess_user_gemini_api_key');
      if (stored && stored.trim()) {
        const trimmed = stored.trim();
        setCustomApiKey(trimmed);
        setInputApiKey(trimmed);
      }
    } catch {
      // localStorage may fail in restricted iframes
    }
  }, []);

  // Responsive board width observer
  useEffect(() => {
    if (!boardContainerRef.current) return;
    const updateSize = () => {
      if (boardContainerRef.current) {
        const width = boardContainerRef.current.clientWidth;
        if (width > 0) {
          setBoardWidth(Math.floor(width));
        }
      }
    };

    updateSize();

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setBoardWidth(Math.floor(entry.contentRect.width));
        }
      }
    });

    observer.observe(boardContainerRef.current);
    window.addEventListener('resize', updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Save custom API key
  const handleSaveApiKey = (keyToSave: string) => {
    const trimmed = keyToSave.trim();
    setCustomApiKey(trimmed);
    setInputApiKey(trimmed);
    try {
      if (trimmed) {
        localStorage.setItem('chess_user_gemini_api_key', trimmed);
      } else {
        localStorage.removeItem('chess_user_gemini_api_key');
      }
    } catch {
      // Ignore
    }
  };

  // Test custom API key against server test endpoint
  const handleTestApiKey = async (keyToTest: string) => {
    const trimmed = keyToTest.trim();
    if (!trimmed) {
      setTestKeyStatus('error');
      setTestKeyMessage('กรุณากรอก API Key ก่อนกดทดสอบ');
      return;
    }

    setTestKeyStatus('testing');
    setTestKeyMessage('กำลังเชื่อมต่อและตรวจสอบ API Key กับ Gemini...');

    try {
      const res = await fetch('/api/ai-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify-key',
          apiKey: trimmed,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestKeyStatus('success');
        setTestKeyMessage(data.message || 'API Key ใช้งานได้สมบูรณ์!');
        handleSaveApiKey(trimmed);
      } else {
        setTestKeyStatus('error');
        setTestKeyMessage(data.error || 'การตรวจสอบ API Key ล้มเหลว กรุณาตรวจสอบคีย์');
      }
    } catch (err: any) {
      setTestKeyStatus('error');
      setTestKeyMessage(`ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อทดสอบคีย์: ${err?.message || 'Network error'}`);
    }
  };

  // Clear custom API key
  const handleClearApiKey = () => {
    setCustomApiKey('');
    setInputApiKey('');
    setTestKeyStatus('idle');
    setTestKeyMessage('');
    try {
      localStorage.removeItem('chess_user_gemini_api_key');
    } catch {
      // Ignore
    }
  };

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

    // If Player chose Black in PvAI mode: AI is White and plays first automatically!
    if (mode === 'pvai' && color === 'b') {
      nextMoveTimerRef.current = setTimeout(() => {
        if (!isAiThinkingRef.current && gameRef.current.turn() === 'w') {
          requestAiMove(newGame.fen(), 'w');
        }
      }, 300);
    }
  };

  // Helper to get formatted AI level and model name
  const getAiModelName = (modelKey: string) => {
    const found = AI_LEVELS.find((l) => l.model === modelKey);
    return found ? `${found.name}` : modelKey;
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

        const chosenModel = gameMode === 'pvai' ? playerAiModel : (aiSide === 'w' ? whiteAiModel : blackAiModel);
        
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            response = await fetch('/api/ai-move', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(customApiKey ? { 'x-gemini-api-key': customApiKey.trim() } : {}),
              },
              body: JSON.stringify({
                fen: currentFen,
                aiColor: aiSide,
                legalMoves,
                model: chosenModel,
                apiKey: customApiKey ? customApiKey.trim() : undefined,
              }),
            });
            break;
          } catch (fErr: any) {
            lastFetchErr = fErr;
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 600));
            }
          }
        }

        if (!response) {
          throw new Error(
            lastFetchErr?.message === 'Failed to fetch' || lastFetchErr?.name === 'TypeError'
              ? 'การเชื่อมต่อไปยังเซิร์ฟเวอร์ขัดข้อง กรุณากดปุ่ม "เดินหมากสำรอง" หรือลองใหม่อีกครั้ง'
              : lastFetchErr?.message || 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'
          );
        }

        const rawText = await response.text();
        let data: any = null;
        try {
          data = JSON.parse(rawText);
        } catch {
          if (rawText.includes('FUNCTION_INVOCATION_FAILED')) {
            throw new Error(
              'เซิร์ฟเวอร์ Vercel ขัดข้อง (FUNCTION_INVOCATION_FAILED): กรุณากดปุ่ม "เดินหมากสำรองทันที" เพื่อเล่นต่อ หรือใส่ Gemini API Key ส่วนตัว'
            );
          }
          throw new Error(
            `เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (${response.status}): ${
              rawText.length > 100 ? rawText.slice(0, 100) + '...' : rawText || 'ไม่มีข้อมูลตอบกลับ'
            }`
          );
        }

        // Ignore stale responses if game has moved on
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
        setUsedCustomKeyForLastMove(Boolean(data.move.isCustomKey || customApiKey));

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
    [gameMode, whiteAiModel, blackAiModel, playerAiModel, customApiKey]
  );

  // Emergency fallback move executed directly on the client if server or AI is unreachable
  const executeLocalFallbackMove = useCallback(() => {
    if (gameRef.current.isGameOver()) return;
    const currentTurnColor = gameRef.current.turn();
    const legalMoves = gameRef.current.moves({ verbose: true });
    if (legalMoves.length === 0) return;

    // Prefer tactical captures or checks if available
    const tacticalMoves = legalMoves.filter((m) => m.san.includes('x') || m.san.includes('+') || m.san.includes('#'));
    const pool = tacticalMoves.length > 0 ? tacticalMoves : legalMoves;
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    try {
      const res = gameRef.current.move({
        from: chosen.from,
        to: chosen.to,
        promotion: chosen.promotion || undefined,
      });

      if (res) {
        setFen(gameRef.current.fen());
        setHistory(gameRef.current.history());
        setLastMove({ from: chosen.from, to: chosen.to });
        setAiError(null);
        const reasonText = 'เดินหมากคำนวณสำรอง (ฉุกเฉิน)';
        if (currentTurnColor === 'w') {
          setWhiteAiReason(reasonText);
        } else {
          setBlackAiReason(reasonText);
        }
      }
    } catch (e) {
      console.error('Failed to execute fallback move:', e);
    }
  }, []);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (nextMoveTimerRef.current) {
        clearTimeout(nextMoveTimerRef.current);
      }
    };
  }, []);

  const currentTurn = gameRef.current.turn();
  const isGameOver = gameRef.current.isGameOver();
  const isUserTurn = gameMode === 'pvai' && currentTurn === userColor;

  // Main turn loop orchestrator
  useEffect(() => {
    if (!gameStarted || isGameOver) return;

    if (nextMoveTimerRef.current) {
      clearTimeout(nextMoveTimerRef.current);
      nextMoveTimerRef.current = null;
    }

    // 1. Mode: Player vs AI
    if (gameMode === 'pvai') {
      const turn = gameRef.current.turn();
      const needsAiMove = turn !== userColor; // If it's not player's turn, AI must play!
      
      if (needsAiMove && !isAiThinking && !aiError) {
        nextMoveTimerRef.current = setTimeout(() => {
          if (!isAiThinkingRef.current && gameRef.current.turn() !== userColor && !gameRef.current.isGameOver()) {
            requestAiMove(gameRef.current.fen(), turn);
          }
        }, 200);
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
        const m = currentTurn === 'w' ? whiteAiModel : blackAiModel;
        return `AI ฝ่าย${currentTurn === 'w' ? 'ขาว' : 'ดำ'} (${getAiModelName(m)}) กำลังคิด...`;
      }
      return `AI (${getAiModelName(playerAiModel)}) กำลังคิด...`;
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
    return `ตาของ AI (${getAiModelName(playerAiModel)})`;
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
                  ? `ประลองหมากรุกกับ AI (${getAiModelName(playerAiModel)})`
                  : `การแข่งขัน: ${getAiModelName(whiteAiModel)} (ขาว) vs ${getAiModelName(blackAiModel)} (ดำ)`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* API Key Status / Config Button */}
            <button
              onClick={() => {
                setInputApiKey(customApiKey);
                setTestKeyStatus('idle');
                setTestKeyMessage('');
                setShowApiKeyModal(true);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all cursor-pointer ${
                customApiKey
                  ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30'
                  : 'bg-[#222632] hover:bg-[#2b3040] text-amber-300 border border-amber-500/30'
              }`}
              title="ตั้งค่า API Key ส่วนตัว ไม่จำกัดโควตา"
            >
              <Key className="w-3.5 h-3.5 text-current" />
              <span className="hidden sm:inline">
                {customApiKey ? 'ใช้ API Key ส่วนตัว' : 'ใส่ API Key (เล่นไม่จำกัด)'}
              </span>
              <span className="sm:hidden">API Key</span>
              {customApiKey && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
              )}
            </button>

            <button
              onClick={() => setBoardOrientation((prev) => (prev === 'white' ? 'black' : 'white'))}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-[#222632] hover:bg-[#2b3040] text-neutral-200 border border-[#313748] transition-colors cursor-pointer"
              title="กลับด้านมุมมองกระดาน"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">กลับด้าน</span>
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
                        ? `${getAiModelName(blackAiModel)} (ดำ)`
                        : `${getAiModelName(whiteAiModel)} (ขาว)`}
                    </span>
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4 text-purple-400" />
                    <span>
                      {getAiModelName(playerAiModel)} ({userColor === 'w' ? 'ฝ่ายดำ' : 'ฝ่ายขาว'})
                    </span>
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
          <div
            ref={boardContainerRef}
            className="w-full aspect-square relative rounded-xl overflow-hidden shadow-2xl border border-[#2e3342] bg-[#1a1d26] min-w-[280px] min-h-[280px]"
          >
            {isMounted && boardWidth > 0 && (
              <Chessboard
                options={{
                  id: 'main-chessboard',
                  position: fen,
                  boardOrientation,
                  showAnimations: false,
                  animationDurationInMs: 0,
                  onPieceDrop: handlePieceDrop,
                  onSquareClick: handleSquareClick,
                  canDragPiece: ({ piece }) =>
                    gameMode === 'pvai' &&
                    piece.pieceType.startsWith(userColor) &&
                    currentTurn === userColor &&
                    !isAiThinking &&
                    !isGameOver,
                  squareStyles: getCustomSquareStyles(),
                  darkSquareStyle: { backgroundColor: '#b58863' },
                  lightSquareStyle: { backgroundColor: '#f0d9b5' },
                  boardStyle: {
                    borderRadius: '12px',
                  },
                }}
              />
            )}

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
                        ? `${getAiModelName(whiteAiModel)} (ขาว)`
                        : `${getAiModelName(blackAiModel)} (ดำ)`}
                    </span>
                  </>
                ) : (
                  <>
                    <User className="w-4 h-4 text-blue-400" />
                    <span>คุณ ({userColor === 'w' ? 'ฝ่ายขาว' : 'ฝ่ายดำ'})</span>
                  </>
                )}
              </span>
            </div>

            {currentTurn === (boardOrientation === 'white' ? 'w' : 'b') && !isGameOver && (
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
        </div>

        {/* Right Panel: Game Status, Controls & Move History */}
        <div className="w-full lg:w-[380px] flex flex-col gap-4">
          {/* Status Box */}
          <div className="bg-[#181a22] rounded-xl border border-[#262a36] p-4 shadow-md">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                สถานะการแข่งขัน
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isGameOver
                      ? 'bg-red-400'
                      : isAiThinking
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-emerald-400'
                  }`}
                />
                <span className="text-xs text-neutral-400 font-mono">
                  {gameRef.current.history().length} ตาเดิน
                </span>
              </div>
            </div>

            <div className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              {getGameStatusText()}
            </div>

            {/* AI vs AI Controls */}
            {gameMode === 'aivsai' && !isGameOver && (
              <div className="mt-3 pt-3 border-t border-[#262a36] flex items-center justify-between gap-2">
                <button
                  onClick={() => setIsAiVsAiPaused((prev) => !prev)}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    isAiVsAiPaused
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  {isAiVsAiPaused ? (
                    <>
                      <Play className="w-3.5 h-3.5" /> ดำเนินการต่อ
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5" /> หยุดชั่วคราว
                    </>
                  )}
                </button>

                {isAiVsAiPaused && (
                  <button
                    onClick={handleStepAiVsAi}
                    disabled={isAiThinking}
                    className="py-1.5 px-3 rounded-lg text-xs font-medium bg-[#222632] hover:bg-[#2b3040] disabled:opacity-50 text-neutral-200 border border-[#313748] flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <SkipForward className="w-3.5 h-3.5" /> เดิน 1 ตา
                  </button>
                )}

                <div className="flex items-center gap-1 text-xs text-neutral-400">
                  <span>ความเร็ว:</span>
                  <select
                    value={aiVsAiDelay}
                    onChange={(e) => setAiVsAiDelay(Number(e.target.value))}
                    className="bg-[#222632] border border-[#313748] text-white rounded px-1.5 py-1 text-xs focus:outline-none"
                  >
                    <option value={1000}>เร็ว (1วิ)</option>
                    <option value={1800}>ปกติ (1.8วิ)</option>
                    <option value={3000}>ช้า (3วิ)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* AI Error Alert Card */}
          {aiError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3.5 text-xs text-red-200 shadow-md">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-red-300 mb-1">แจ้งเตือนจาก AI Engine</div>
                  <div className="leading-relaxed mb-3 text-red-200">{aiError}</div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        setAiError(null);
                        const turn = gameRef.current.turn();
                        requestAiMove(gameRef.current.fen(), turn);
                      }}
                      className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-medium transition-colors cursor-pointer inline-flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> ลองอีกครั้ง
                    </button>

                    <button
                      onClick={executeLocalFallbackMove}
                      className="px-2.5 py-1 rounded bg-[#2a2636] hover:bg-[#38334a] text-purple-300 border border-purple-500/40 font-medium transition-colors cursor-pointer inline-flex items-center gap-1"
                    >
                      <SkipForward className="w-3 h-3" /> เดินหมากสำรองทันที
                    </button>

                    {!customApiKey && (
                      <button
                        onClick={() => {
                          setInputApiKey('');
                          setShowApiKeyModal(true);
                        }}
                        className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-medium transition-colors cursor-pointer inline-flex items-center gap-1"
                      >
                        <Key className="w-3 h-3" /> ใส่ API Key ส่วนตัว (แก้โควตาเต็ม)
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* API Key Active Indicator Banner */}
          {customApiKey && !aiError && (
            <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-2.5 px-3 flex items-center justify-between text-xs text-emerald-300">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>กำลังใช้ Gemini API Key ส่วนตัว (โควตาอิสระ)</span>
              </div>
              <button
                onClick={() => setShowApiKeyModal(true)}
                className="text-[11px] text-emerald-400 hover:underline cursor-pointer"
              >
                จัดการ
              </button>
            </div>
          )}

          {/* AI Reasoning Box */}
          {gameMode === 'aivsai' ? (
            <div className="bg-[#181a22] rounded-xl border border-[#262a36] p-3.5 shadow-md space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold text-neutral-300">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>การวิเคราะห์กลยุทธ์ของ AI</span>
                </span>
                {usedCustomKeyForLastMove && (
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">
                    Custom Key
                  </span>
                )}
              </div>

              {/* White AI Card */}
              <div className="p-2.5 rounded-lg bg-[#202430] border border-[#2e3444] text-xs">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-semibold text-neutral-100">
                    <span className="w-2.5 h-2.5 rounded-full bg-neutral-100 inline-block" />
                    <span>AI ขาว ({getAiModelName(whiteAiModel)}):</span>
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
                    <span>AI ดำ ({getAiModelName(blackAiModel)}):</span>
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
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-300 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>ความคิดของ AI ({getAiModelName(playerAiModel)}):</span>
                  </span>
                  {usedCustomKeyForLastMove && (
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">
                      Custom Key
                    </span>
                  )}
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

      {/* API Key Settings Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-[#181a22] border border-[#2f3547] rounded-2xl p-5 sm:p-6 max-w-lg w-full text-left shadow-2xl my-6">
            <div className="flex items-center justify-between mb-3 border-b border-[#262a36] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center border border-amber-500/30">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white">ตั้งค่า Gemini API Key ส่วนตัว</h2>
                  <p className="text-xs text-neutral-400">เล่นได้ไม่จำกัด ไม่ต้องรอหรือพึ่งพาโควตากลาง</p>
                </div>
              </div>
              <button
                onClick={() => setShowApiKeyModal(false)}
                className="text-neutral-400 hover:text-white text-lg p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Current Status Banner */}
            <div className="mb-4">
              {customApiKey ? (
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>กำลังใช้งาน Gemini API Key ส่วนตัวของคุณ</span>
                  </div>
                  <button
                    onClick={handleClearApiKey}
                    className="text-red-400 hover:text-red-300 flex items-center gap-1 font-medium cursor-pointer"
                    title="ลบเพื่อกลับไปใช้โควตาเริ่มต้น"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> ลบคีย์
                  </button>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/25 text-xs text-blue-300 leading-relaxed">
                  ℹ️ ขณะนี้กำลังใช้โควตากลางของระบบ ซึ่งมีจำกัด หากคุณใส่ API Key ของคุณเอง (สร้างได้ฟรี) จะเล่นได้ต่อเนื่องไม่มีสะดุดทั้งโหมด แข่งกับ AI และ AI vs AI
                </div>
              )}
            </div>

            {/* Input Form */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                  วาง Google Gemini API Key ของคุณ:
                </label>
                <div className="relative">
                  <input
                    type={showKeyText ? 'text' : 'password'}
                    value={inputApiKey}
                    onChange={(e) => {
                      setInputApiKey(e.target.value);
                      if (testKeyStatus !== 'idle') {
                        setTestKeyStatus('idle');
                        setTestKeyMessage('');
                      }
                    }}
                    placeholder="AIzaSy..."
                    className="w-full py-2.5 pl-3 pr-10 rounded-xl bg-[#222632] border border-[#313748] text-white text-xs sm:text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKeyText((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                  >
                    {showKeyText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Test Status Feedback */}
              {testKeyMessage && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                    testKeyStatus === 'testing'
                      ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                      : testKeyStatus === 'success'
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/15 border border-red-500/30 text-red-300'
                  }`}
                >
                  {testKeyStatus === 'testing' && <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 mt-0.5" />}
                  {testKeyStatus === 'success' && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />}
                  {testKeyStatus === 'error' && <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />}
                  <div className="flex-1 leading-relaxed">{testKeyMessage}</div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleTestApiKey(inputApiKey)}
                  disabled={testKeyStatus === 'testing' || !inputApiKey.trim()}
                  className="flex-1 py-2 rounded-xl bg-[#262b3a] hover:bg-[#32394c] disabled:opacity-50 text-neutral-200 border border-[#384055] text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {testKeyStatus === 'testing' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> กำลังตรวจสอบ...
                    </>
                  ) : (
                    <>
                      <Sparkle className="w-3.5 h-3.5 text-amber-400" /> ทดสอบการเชื่อมต่อ
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleSaveApiKey(inputApiKey);
                    setShowApiKeyModal(false);
                  }}
                  className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Check className="w-3.5 h-3.5" /> บันทึกและเริ่มเล่น
                </button>
              </div>
            </div>

            {/* How to get a free Gemini API Key guide */}
            <div className="p-3.5 rounded-xl bg-[#1f2330] border border-[#2b3144] text-xs space-y-2">
              <div className="font-semibold text-neutral-200 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-blue-400" />
                <span>วิธีรับ Gemini API Key ฟรีใน 30 วินาที:</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-neutral-300 text-[11px] leading-relaxed">
                <li>เปิด Google AI Studio (ล็อกอินด้วยบัญชี Google ของคุณ)</li>
                <li>คลิกปุ่ม <strong>&quot;Get API key&quot;</strong> หรือ <strong>&quot;Create API key&quot;</strong></li>
                <li>คัดลอกคีย์ที่ขึ้นต้นด้วย <code>AIzaSy...</code> แล้วนำมาวางในช่องด้านบน</li>
              </ol>

              <div className="pt-1 flex items-center justify-between">
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium hover:underline"
                >
                  เปิด Google AI Studio เพื่อรับ Key ฟรี <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <p className="mt-3 text-[10px] text-neutral-500 text-center">
              🔒 คีย์จะถูกบันทึกไว้ใน Browser ของคุณเท่านั้น ไม่มีการส่งไปเก็บในฐานข้อมูลภายนอก ปลอดภัย 100%
            </p>
          </div>
        </div>
      )}

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
                      key={lvl.id}
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

                {/* API Key Shortcut */}
                <div className="mb-4 p-2.5 rounded-xl bg-[#202430] border border-[#2d3342] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-neutral-300">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    <span>{customApiKey ? 'ใช้ API Key ส่วนตัวแล้ว ✅' : 'ต้องการใส่ API Key ส่วนตัว?'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setInputApiKey(customApiKey);
                      setShowApiKeyModal(true);
                    }}
                    className="text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                  >
                    {customApiKey ? 'แก้ไข' : 'ใส่คีย์ฟรี'}
                  </button>
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
                        <option key={lvl.id} value={lvl.model}>
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
                        <option key={lvl.id} value={lvl.model}>
                          {lvl.name} ({lvl.desc})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* API Key Shortcut */}
                  <div className="p-2.5 rounded-xl bg-[#202430] border border-[#2d3342] flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-neutral-300">
                      <Key className="w-3.5 h-3.5 text-amber-400" />
                      <span>{customApiKey ? 'ใช้ API Key ส่วนตัวแล้ว ✅' : 'ใส่ API Key ส่วนตัวเพื่อแข่งได้ยาวนาน'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setInputApiKey(customApiKey);
                        setShowApiKeyModal(true);
                      }}
                      className="text-purple-400 hover:text-purple-300 font-medium cursor-pointer"
                    >
                      {customApiKey ? 'แก้ไข' : 'ใส่คีย์ฟรี'}
                    </button>
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
                    className="w-2/3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs text-white font-semibold transition-colors cursor-pointer shadow-sm"
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
                <p className="text-xs text-neutral-400 mb-4">
                  เลือกรูปแบบการแข่งขันหมากรุกที่คุณต้องการ
                </p>

                {/* API Key Banner inside Modal */}
                <div className="mb-4 p-3 rounded-xl bg-[#202432] border border-[#2d3448] flex items-center justify-between text-xs text-left">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-neutral-200">
                        {customApiKey ? 'API Key ส่วนตัว: พร้อมใช้งาน' : 'ใส่ API Key ส่วนตัว (ฟรี)'}
                      </div>
                      <div className="text-[11px] text-neutral-400">
                        {customApiKey ? 'เล่นได้อิสระ ไม่จำกัดโควตา' : 'ไม่พึ่งพาโควตาคนสร้าง เล่นได้ไม่จำกัด'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setInputApiKey(customApiKey);
                      setShowApiKeyModal(true);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-[#2b3144] hover:bg-[#373f56] text-amber-300 border border-amber-500/30 text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    {customApiKey ? 'ดูคีย์' : 'ใส่คีย์ฟรี'}
                  </button>
                </div>

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
