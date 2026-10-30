"""The network: one shared body, a policy head over the 42 move slots, and a value head that predicts the
round's money. Illegal moves are masked out, so the AI can never choose one."""

from __future__ import annotations

import torch
from torch import nn


class PolicyValue(nn.Module):
    def __init__(self, obs_size: int, actions: int, hidden: int = 512):
        super().__init__()
        self.body = nn.Sequential(
            nn.Linear(obs_size, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
        )
        self.policy = nn.Linear(hidden, actions)
        self.value = nn.Linear(hidden, 1)

    def forward(self, obs: torch.Tensor, mask: torch.Tensor):
        h = self.body(obs)
        logits = self.policy(h).masked_fill(~mask, -1e9)
        return logits, self.value(h).squeeze(-1)

    @torch.no_grad()
    def act(self, obs: torch.Tensor, mask: torch.Tensor, greedy: bool = False):
        logits, value = self(obs, mask)
        dist = torch.distributions.Categorical(logits=logits)
        action = logits.argmax(-1) if greedy else dist.sample()
        return action, dist.log_prob(action), value
