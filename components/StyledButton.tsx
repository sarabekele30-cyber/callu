"use client";
import React from 'react';
import styled from 'styled-components';
import { ArrowRight } from 'lucide-react';

interface StyledButtonProps {
  onClick?: () => void;
  text?: string;
}

const StyledButton = ({ onClick, text = "Apply to Join" }: StyledButtonProps) => {
  return (
    <StyledWrapper onClick={onClick}>
      <button className="button">
        <div className="icon">
          <ArrowRight className="w-5 h-5" />
        </div>
        <span className="title">{text}</span>
      </button>
    </StyledWrapper>
  );
}

const StyledWrapper = styled.div`
  .button {
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    font-size: 16px;
    background-image: linear-gradient(#3470fa, #313ed7);
    color: white;
    border: solid 2px #0618db;
    height: 60px;
    padding: 0px 40px;
    border-radius: 50px;
    font-weight: 600;
    transform: scale(1);
    position: relative;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }

  .button:hover {
    transform: translateY(-2px);
    box-shadow: 0 20px 25px -5px rgba(52, 112, 250, 0.4), 0 10px 10px -5px rgba(52, 112, 250, 0.2);
    border-color: #4c82fb;
  }
  
  .button:active {
    background-image: linear-gradient(#313ed7, #3470fa);
    border-color: #313ed7;
    transform: translateY(1px);
  }
  
  .icon {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .icon svg {
    width: 20px;
    height: 20px;
    transition: transform 0.3s ease;
  }
  
  .button:hover .icon svg {
    transform: translateX(4px);
  }
`;

export default StyledButton;
