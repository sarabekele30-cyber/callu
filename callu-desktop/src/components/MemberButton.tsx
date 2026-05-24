"use client";
import React from 'react';
import styled from 'styled-components';

interface MemberButtonProps {
  onClick?: () => void;
  text?: string;
}

const MemberButton = ({ onClick, text = "Member Area" }: MemberButtonProps) => {
  return (
    <StyledWrapper onClick={onClick}>
      <div className="btn-wrapper">
        <div className="line horizontal top" />
        <div className="line vertical right" />
        <div className="line horizontal bottom" />
        <div className="line vertical left" />
        <div className="dot top left" />
        <div className="dot top right" />
        <div className="dot bottom right" />
        <div className="dot bottom left" />
        <button className="btn">
          <span className="btn-text">{text}</span>
          <svg className="btn-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.6744 11.4075L15.7691 17.1233C15.7072 17.309 15.5586 17.4529 15.3709 17.5087L3.69348 20.9803C3.22819 21.1186 2.79978 20.676 2.95328 20.2155L6.74467 8.84131C6.79981 8.67588 6.92419 8.54263 7.08543 8.47624L12.472 6.25822C12.696 6.166 12.9535 6.21749 13.1248 6.38876L17.5294 10.7935C17.6901 10.9542 17.7463 11.1919 17.6744 11.4075Z" />
            <path d="M3.2959 20.6016L9.65986 14.2376" />
            <path d="M17.7917 11.0557L20.6202 8.22724C21.4012 7.44619 21.4012 6.17986 20.6202 5.39881L18.4989 3.27749C17.7178 2.49645 16.4515 2.49645 15.6704 3.27749L12.842 6.10592" />
            <path d="M11.7814 12.1163C11.1956 11.5305 10.2458 11.5305 9.66004 12.1163C9.07426 12.7021 9.07426 13.6519 9.66004 14.2376C10.2458 14.8234 11.1956 14.8234 11.7814 14.2376C12.3671 13.6519 12.3671 12.7021 11.7814 12.1163Z" />
          </svg>
        </button>
      </div>
    </StyledWrapper>
  );
}

const StyledWrapper = styled.div`
  .btn-wrapper {
    --dot-size: 4px;
    --line-weight: 1px;
    --line-distance: 6px;
    --animation-speed: 0.35s;
    --dot-color: #555;
    --line-color: #333;

    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: auto;
    height: auto;
    padding: var(--line-distance);
    background-color: transparent;
    transition: background-color 0.3s ease-in-out;
    user-select: none;
    cursor: pointer;
  }

  .btn-wrapper:has(.btn:hover) {
    animation: backround-color-change calc(var(--animation-speed) * 4) ease-in-out forwards;
  }
  
  @keyframes backround-color-change {
    80% { background-color: transparent; }
    100% { background-color: rgba(229, 255, 0, 0.1); }
  }

  .btn {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0.6rem 1.25rem;
    background-color: transparent;
    border: 1px solid #333;
    color: #999;
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    text-transform: capitalize;
    border-radius: 9999px;
    cursor: pointer;
    overflow: hidden;
    transition: all 0.3s ease;
  }

  .btn:hover {
    background-color: #fff;
    color: #000;
    transform: scale(1.05);
    border-color: #fff;
  }
  
  .btn:active {
    transform: scale(0.98);
  }

  .btn-svg {
    margin-left: 0.5rem;
    height: 16px;
    width: 16px;
    stroke-width: 1;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke: currentColor;
    fill: currentColor;
    transition: all 0.3s ease-in-out;
    opacity: 0.7;
  }

  /* Dots */
  .dot {
    position: absolute;
    width: var(--dot-size);
    aspect-ratio: 1;
    border-radius: 50%;
    background-color: var(--dot-color);
    transition: all 0.3s ease-in-out;
    opacity: 0;
  }

  .btn-wrapper:hover .dot {
    opacity: 1;
  }

  .btn-wrapper:has(.btn:hover) .dot.top.left {
    top: 50%;
    left: 20%;
    animation: move-top-left var(--animation-speed) ease-in-out forwards;
  }
  @keyframes move-top-left {
    90% { opacity: 0.6; }
    100% { top: -2px; left: -2px; opacity: 1; }
  }
  
  .btn-wrapper:has(.btn:hover) .dot.top.right {
    top: 50%;
    right: 20%;
    animation: move-top-right var(--animation-speed) ease-in-out forwards;
    animation-delay: calc(var(--animation-speed) * 0.6);
  }
  @keyframes move-top-right {
    80% { opacity: 0.6; }
    100% { top: -2px; right: -2px; opacity: 1; }
  }
  
  .btn-wrapper:has(.btn:hover) .dot.bottom.right {
    bottom: 50%;
    right: 20%;
    animation: move-bottom-right var(--animation-speed) ease-in-out forwards;
    animation-delay: calc(var(--animation-speed) * 1.2);
  }
  @keyframes move-bottom-right {
    80% { opacity: 0.6; }
    100% { bottom: -2px; right: -2px; opacity: 1; }
  }
  
  .btn-wrapper:has(.btn:hover) .dot.bottom.left {
    bottom: 50%;
    left: 20%;
    animation: move-bottom-left var(--animation-speed) ease-in-out forwards;
    animation-delay: calc(var(--animation-speed) * 1.8);
  }
  @keyframes move-bottom-left {
    80% { opacity: 0.6; }
    100% { bottom: -2px; left: -2px; opacity: 1; }
  }

  /* Lines */
  .line {
    position: absolute;
    transition: all 0.3s ease-in-out;
    background-color: var(--line-color);
  }
  
  .line.horizontal {
    height: 1px;
    width: 100%;
    transform: scaleX(0);
  }
  
  .line.vertical {
    width: 1px;
    height: 100%;
    transform: scaleY(0);
  }
  
  .line.top { top: 0; transform-origin: left; }
  .line.bottom { bottom: 0; transform-origin: right; }
  .line.left { left: 0; transform-origin: top; }
  .line.right { right: 0; transform-origin: bottom; }

  .btn-wrapper:has(.btn:hover) .line.top {
    animation: draw-h var(--animation-speed) ease-in-out forwards;
    animation-delay: calc(var(--animation-speed) * 0.8);
  }
  .btn-wrapper:has(.btn:hover) .line.bottom {
    animation: draw-h var(--animation-speed) ease-in-out forwards;
    animation-delay: calc(var(--animation-speed) * 2);
  }
  @keyframes draw-h { 100% { transform: scaleX(1); } }
  
  .btn-wrapper:has(.btn:hover) .line.left {
    animation: draw-v var(--animation-speed) ease-in-out forwards;
    animation-delay: calc(var(--animation-speed) * 2.4);
  }
  .btn-wrapper:has(.btn:hover) .line.right {
    animation: draw-v var(--animation-speed) ease-in-out forwards;
    animation-delay: calc(var(--animation-speed) * 1.4);
  }
  @keyframes draw-v { 100% { transform: scaleY(1); } }
`;

export default MemberButton;
