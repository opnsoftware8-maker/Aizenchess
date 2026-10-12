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
} from 'lucide-react';

type PlayerColor = 'w' | 'b';
type PromotionPiece = 'q' | 'r' | 'b' | 'n';

interface PendingPromotion {
  from: Square;
  to: Square;
}

export default function ChessGame() {
  // chess.js is the only source of truth
  const gameRef = useRef<Chess>(new Chess());

  // UI state derived from gameRef
  const [fen, setFen] = useState<string>(() => gameRef.current.fen());
  const [history, setHistory] = useState<string[]>([]);
  const [userColor, setUserColor] = useState<PlayerColor>('w');
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  const [gameStarted, setGameStarted] = useState<boolean>(false);
  const [showColorModal, setShowColorModal] = useState<boolean>(true);

  // Interaction state
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiReason, setAiReason] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);

  const isAiThinkingRef = useRef<boolean>(false);
  const currentRequestIdRef = useRef<number>(0);
  const historyEndRef = useRef<HTMLDivElement>(null);

  const aiColor: PlayerColor = userColor === 'w' ? 'b' : 'w';
  const isUserTurn = gameRef.current.turn() === userColor;
  const isGameOver = gameRef.current.isGameOver();

  // Scroll history into view when new moves are made
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Request AI move from server
  const requestAiMove = useCallback(
    async (currentFen: string) => {
      const currentGame = gameRef.current;
      if (currentGame.isGameOver() || currentGame.turn() !== aiColor) {
        return;
      }

      // ป้องกันการเรียกซ้อนกันขณะกำลังประมวลผล
      if (isAiThinkingRef.current) {
        return;
      }

      isAiThinkingRef.current = true;
      setIsAiThinking(true);
      setAiError(null);

      const requestId = ++currentRequestIdRef.current;

      // Compute legal moves on client as supplementary context
      const legalMoves = currentGame.moves({ verbose: true }).map((m) => ({
        from: m.from,
        to: m.to,
        promotion: m.promotion || null,
        san: m.san,
      }));

      try {
        const response = await fetch('/api/ai-move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fen: currentFen,
            aiColor,
            legalMoves,
          }),
        });

        const data = await response.json();

        // ตรวจสอบว่าคำขอนี้ยังเป็นคำขอล่าสุดอยู่หรือไม่ (ป้องกัน Stale response จากเกมก่อนหน้า)
        if (requestId !== currentRequestIdRef.current) {
          return;
        }

        // ตรวจสอบว่ากระดานยังคงเป็นตำแหน่งเดิมและถึงตาของ AI อยู่หรือไม่
        if (gameRef.current.fen() !== currentFen || gameRef.current.turn() !== aiColor) {
          return;
        }

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'ไม่สามารถรับตาเดินจาก AI ได้');
        }

        // Validate & apply AI move strictly via chess.js with try/catch
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
        setFen(gameRef.current.fen());
        setHistory(gameRef.current.history());
        setLastMove({ from: data.move.from, to: data.move.to });
        if (data.move.reason) {
          setAiReason(data.move.reason);
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
    [aiColor]
  );

  // Trigger AI move if it's AI's turn
  useEffect(() => {
    if (!gameStarted || isGameOver) return;

    if (gameRef.current.turn() === aiColor && !isAiThinking && !aiError) {
      requestAiMove(gameRef.current.fen());
    }
  }, [fen, gameStarted, isGameOver, aiColor, isAiThinking, aiError, requestAiMove]);

  // Start new game with chosen color
  const startNewGame = (chosenColor: PlayerColor) => {
    // ยกเลิกคำขอ AI เดิมที่อาจยังค้างอยู่
    currentRequestIdRef.current += 1;
    isAiThinkingRef.current = false;

    const newGame = new Chess();
    gameRef.current = newGame;

    setUserColor(chosenColor);
    setBoardOrientation(chosenColor === 'w' ? 'white' : 'black');
    setFen(newGame.fen());
    setHistory([]);
    setLastMove(null);
    setSelectedSquare(null);
    setAiError(null);
    setAiReason(null);
    setPendingPromotion(null);
    setIsAiThinking(false);
    setGameStarted(true);
    setShowColorModal(false);
  };

  // Execute a player move through chess.js
  const executePlayerMove = (from: Square, to: Square, promotion?: PromotionPiece): boolean => {
    if (isAiThinkingRef.current) return false;
    currentRequestIdRef.current += 1;

    try {
      const move = gameRef.current.move({
        from,
        to,
        promotion: promotion || undefined,
      });

      if (!move) return false;

      // Update state strictly from chess.js
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

  // Check if a move requires pawn promotion
  const isPawnPromotion = (from: Square, to: Square): boolean => {
    const piece = gameRef.current.get(from);
    if (!piece || piece.type !== 'p') return false;

    // White pawn reaching rank 8 or Black pawn reaching rank 1
    return (
      (piece.color === 'w' && to.endsWith('8')) ||
      (piece.color === 'b' && to.endsWith('1'))
    );
  };

  // Handle Drag-and-Drop
  const handlePieceDrop = ({
    sourceSquare,
    targetSquare,
  }: {
    piece: any;
    sourceSquare: string;
    targetSquare: string | null;
  }): boolean => {
    if (!targetSquare || isAiThinking || isGameOver || !isUserTurn) {
      return false;
    }

    const from = sourceSquare as Square;
    const to = targetSquare as Square;

    // Check if player owns the source piece
    const piece = gameRef.current.get(from);
    if (!piece || piece.color !== userColor) {
      return false;
    }

    // Check if move is legal
    const legalMoves = gameRef.current.moves({ square: from, verbose: true });
    const isLegalTarget = legalMoves.some((m) => m.to === to);
    if (!isLegalTarget) {
      return false;
    }

    // Handle pawn promotion
    if (isPawnPromotion(from, to)) {
      setPendingPromotion({ from, to });
      return false; // Wait for player selection dialog
    }

    return executePlayerMove(from, to);
  };

  // Handle Square Click
  const handleSquareClick = ({ square }: { piece: any; square: string }) => {
    if (isAiThinking || isGameOver || !isUserTurn) return;

    const sq = square as Square;
    const clickedPiece = gameRef.current.get(sq);

    // If a square is already selected
    if (selectedSquare) {
      // If clicking the same square, deselect
      if (selectedSquare === sq) {
        setSelectedSquare(null);
        return;
      }

      // If clicking another piece of the user's own color, switch selection
      if (clickedPiece && clickedPiece.color === userColor) {
        setSelectedSquare(sq);
        return;
      }

      // Check if clicking a legal destination
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

      // Invalid click, clear selection
      setSelectedSquare(null);
      return;
    }

    // Select piece if it belongs to current player
    if (clickedPiece && clickedPiece.color === userColor) {
      setSelectedSquare(sq);
    }
  };

  // Confirm pawn promotion piece selection
  const handlePromotionSelect = (piece: PromotionPiece) => {
    if (!pendingPromotion) return;
    executePlayerMove(pendingPromotion.from, pendingPromotion.to, piece);
    setPendingPromotion(null);
  };

  // Generate square highlights: legal moves, selected piece, last move
  const getCustomSquareStyles = (): Record<string, React.CSSProperties> => {
    const styles: Record<string, React.CSSProperties> = {};

    // 1. Highlight last move (soft golden background)
    if (lastMove) {
      styles[lastMove.from] = {
        backgroundColor: 'rgba(234, 179, 8, 0.28)',
      };
      styles[lastMove.to] = {
        backgroundColor: 'rgba(234, 179, 8, 0.28)',
      };
    }

    // 2. Highlight selected square (blue outline)
    if (selectedSquare) {
      styles[selectedSquare] = {
        boxShadow: 'inset 0 0 0 3px #3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.22)',
      };

      // 3. Highlight legal destination moves
      const moves = gameRef.current.moves({
        square: selectedSquare,
        verbose: true,
      });

      for (const m of moves) {
        const destPiece = gameRef.current.get(m.to as Square);
        const isCapture = Boolean(destPiece || m.captured);

        if (isCapture) {
          // RED capture ring
          styles[m.to] = {
            background:
              'radial-gradient(circle, transparent 52%, #ef4444 54%, #ef4444 72%, transparent 74%)',
            cursor: 'pointer',
          };
        } else {
          // GREEN quiet move dot
          styles[m.to] = {
            background:
              'radial-gradient(circle, #22c55e 25%, transparent 26%)',
            cursor: 'pointer',
          };
        }
      }
    }

    // 4. Highlight King if in check (subtle red alert glow)
    if (gameRef.current.inCheck()) {
      const turn = gameRef.current.turn();
      // Find king position
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

  // Determine game status message in Thai
  const getGameStatusText = () => {
    if (gameRef.current.isCheckmate()) {
      const winner = gameRef.current.turn() === 'w' ? 'ดำ' : 'ขาว';
      return `รุกจน — ฝ่าย${winner} ชนะ`;
    }
    if (gameRef.current.isDraw()) {
      return 'เสมอ';
    }
    if (gameRef.current.inCheck()) {
      return 'รุก';
    }
    if (isAiThinking) {
      return 'AI กำลังคิด...';
    }
    if (isUserTurn) {
      return 'ตาของคุณ';
    }
    return 'ตาของ AI';
  };

  // Group history into move pairs for clean table display
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
      {/* Header */}
      <header className="border-b border-[#242834] bg-[#161820] px-4 py-3 sm:px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>Chess AI</span>
            </h1>
            <p className="text-xs sm:text-sm text-neutral-400">เล่นหมากรุกกับ AI</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setBoardOrientation((prev) => (prev === 'white' ? 'black' : 'white'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-[#222632] hover:bg-[#2b3040] text-neutral-200 border border-[#313748] transition-colors cursor-pointer"
              title="กลับด้านกระดาน"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>กลับด้านกระดาน</span>
            </button>

            <button
              onClick={() => setShowColorModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium bg-[#2563eb] hover:bg-[#1d4ed8] text-white transition-colors cursor-pointer"
              title="เริ่มเกมใหม่"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>เริ่มเกมใหม่</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Board & Panel Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 flex flex-col lg:flex-row gap-6 items-center lg:items-start justify-center">
        {/* Chessboard Column */}
        <div className="flex flex-col items-center w-full max-w-[500px] sm:max-w-[540px]">
          {/* Opponent Info Bar */}
          <div className="w-full flex items-center justify-between py-2 px-3 mb-2 rounded-lg bg-[#181a22] border border-[#262a36]">
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  aiColor === 'w' ? 'bg-neutral-100' : 'bg-neutral-900 border border-neutral-600'
                }`}
              />
              <span className="text-sm font-medium text-neutral-200">
                AI ({aiColor === 'w' ? 'ขาว' : 'ดำ'})
              </span>
            </div>

            {isAiThinking && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>AI กำลังคิด...</span>
              </div>
            )}
          </div>

          {/* Chessboard Container */}
          <div className="w-full aspect-square relative rounded-xl overflow-hidden shadow-2xl border border-[#2e3342] bg-[#1a1d26]">
            <Chessboard
              options={{
                position: fen,
                boardOrientation,
                onPieceDrop: handlePieceDrop,
                onSquareClick: handleSquareClick,
                canDragPiece: ({ piece }) =>
                  piece.pieceType.startsWith(userColor) && !isAiThinking && !isGameOver,
                squareStyles: getCustomSquareStyles(),
                darkSquareStyle: { backgroundColor: '#b58863' },
                lightSquareStyle: { backgroundColor: '#f0d9b5' },
                boardStyle: {
                  borderRadius: '12px',
                },
                animationDurationInMs: 250,
              }}
            />

            {/* Pawn Promotion Dialog */}
            {pendingPromotion && (
              <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-30">
                <div className="bg-[#1e222d] border border-[#363c4e] rounded-xl p-5 max-w-xs w-full text-center shadow-2xl">
                  <h3 className="text-base font-semibold text-white mb-1">
                    เลื่อนขั้นเบี้ย (Pawn Promotion)
                  </h3>
                  <p className="text-xs text-neutral-400 mb-4">
                    เลือกตัวหมากที่ต้องการเลื่อนขั้น
                  </p>
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

          {/* Player Info Bar */}
          <div className="w-full flex items-center justify-between py-2 px-3 mt-2 rounded-lg bg-[#181a22] border border-[#262a36]">
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  userColor === 'w' ? 'bg-neutral-100' : 'bg-neutral-900 border border-neutral-600'
                }`}
              />
              <span className="text-sm font-medium text-neutral-200">
                คุณ ({userColor === 'w' ? 'ขาว' : 'ดำ'})
              </span>
            </div>

            {isUserTurn && !isGameOver && (
              <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 font-medium">
                ตาของคุณ
              </span>
            )}
          </div>
        </div>

        {/* Status & Move History Column */}
        <div className="w-full lg:w-80 flex flex-col gap-4">
          {/* Compact Game Status Card */}
          <div className="bg-[#181a22] rounded-xl border border-[#262a36] p-4 shadow-md">
            <div className="text-xs font-medium text-neutral-400 mb-1">สถานะเกม</div>
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold text-white flex items-center gap-2">
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

            {/* Error & Retry Banner */}
            {aiError && (
              <div className="mt-3 p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex flex-col gap-2">
                <div className="flex items-start gap-1.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{aiError}</span>
                </div>
                <button
                  onClick={() => requestAiMove(gameRef.current.fen())}
                  disabled={isAiThinking}
                  className="self-end px-2.5 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  ลองอีกครั้ง
                </button>
              </div>
            )}

            {/* AI Reasoning Note */}
            {aiReason && !aiError && (
              <div className="mt-3 p-2.5 rounded-lg bg-[#202532] border border-[#2f3547] text-xs text-neutral-300 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-neutral-200">AI: </span>
                  <span>{aiReason}</span>
                </div>
              </div>
            )}
          </div>

          {/* Move History Panel */}
          <div className="bg-[#181a22] rounded-xl border border-[#262a36] p-4 shadow-md flex flex-col flex-1 min-h-[260px] max-h-[380px]">
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
                      <th className="py-1 w-12 font-medium">#</th>
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
                        <td className="py-1.5 text-neutral-500 font-mono">{pair.num}.</td>
                        <td className="py-1.5 text-neutral-200 font-mono font-medium">
                          {pair.white}
                        </td>
                        <td className="py-1.5 text-neutral-400 font-mono font-medium">
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

      {/* Start Game / Color Choice Modal */}
      {showColorModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#181a22] border border-[#2f3547] rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-2">เริ่มเกมใหม่</h2>
            <p className="text-sm text-neutral-400 mb-6">
              เลือกสีที่คุณต้องการเล่น (ฝ่ายขาวเดินก่อนเสมอ)
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={() => startNewGame('w')}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#222632] hover:bg-[#2b3040] border-2 border-transparent hover:border-blue-500 transition-all cursor-pointer group"
              >
                <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-900 flex items-center justify-center text-xl font-bold shadow-md mb-2 group-hover:scale-105 transition-transform">
                  ♔
                </div>
                <span className="text-sm font-semibold text-white">เล่นเป็นฝ่ายขาว</span>
                <span className="text-xs text-neutral-400 mt-0.5">คุณเดินก่อน</span>
              </button>

              <button
                onClick={() => startNewGame('b')}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-[#222632] hover:bg-[#2b3040] border-2 border-transparent hover:border-blue-500 transition-all cursor-pointer group"
              >
                <div className="w-12 h-12 rounded-full bg-neutral-900 text-neutral-100 border border-neutral-700 flex items-center justify-center text-xl font-bold shadow-md mb-2 group-hover:scale-105 transition-transform">
                  ♚
                </div>
                <span className="text-sm font-semibold text-white">เล่นเป็นฝ่ายดำ</span>
                <span className="text-xs text-neutral-400 mt-0.5">AI เดินก่อน</span>
              </button>
            </div>

            {gameStarted && (
              <button
                onClick={() => setShowColorModal(false)}
                className="text-xs text-neutral-400 hover:text-white underline transition-colors cursor-pointer"
              >
                กลับไปที่เกมเดิม
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
