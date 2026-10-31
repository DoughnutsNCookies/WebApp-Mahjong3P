"""The network, in two separate parts:

- the player (actor): chooses moves from the player's own view only. This is the part that plays.
- the coach (critic): estimates how much money the round is worth, from the view plus hidden information
  (opponents' hands, the coming wall tiles). It is used only during training to judge decisions more
  fairly than luck allows, and is never used to choose a move.

The two share no layers, so nothing hidden can leak into the player. Illegal moves are masked out."""

from __future__ import annotations

import torch
from torch import nn


def mlp(inputs: int, hidden: int, layers: int = 3) -> nn.Sequential:
    parts, size = [], inputs
    for _ in range(layers):
        parts += [nn.Linear(size, hidden), nn.ReLU()]
        size = hidden
    return nn.Sequential(*parts)


class PolicyValue(nn.Module):
    def __init__(self, obs_size: int, actions: int, priv_size: int, hidden: int = 512):
        super().__init__()
        self.actor = nn.Sequential(mlp(obs_size, hidden), nn.Linear(hidden, actions))
        self.critic = nn.Sequential(mlp(obs_size + priv_size, hidden), nn.Linear(hidden, 1))

    def logits(self, obs: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        """Move scores from the player's own view only."""
        return self.actor(obs).masked_fill(~mask, -1e9)

    def value(self, obs: torch.Tensor, priv: torch.Tensor) -> torch.Tensor:
        """The coach's estimate of the round's money for this player (training only)."""
        return self.critic(torch.cat([obs, priv], -1)).squeeze(-1)

    @torch.no_grad()
    def act(self, obs: torch.Tensor, mask: torch.Tensor, priv: torch.Tensor | None = None, greedy: bool = False):
        """Chooses moves from the view alone. The value is only computed when `priv` is given (training)."""
        logits = self.logits(obs, mask)
        dist = torch.distributions.Categorical(logits=logits)
        action = logits.argmax(-1) if greedy else dist.sample()
        value = self.value(obs, priv) if priv is not None else None
        return action, dist.log_prob(action), value


def load_widened(model: PolicyValue, state: dict, old_obs: int, new_obs: int) -> None:
    """Loads a network trained on fewer inputs into a wider one (v2 into v3). The new inputs come after the
    old ones and start with zero weight, so the network plays exactly as before until training teaches it
    to use them."""
    state = dict(state)
    target = model.state_dict()
    for key, has_priv in (("actor.0.0.weight", False), ("critic.0.0.weight", True)):
        w, new = state[key], torch.zeros_like(target[key])
        new[:, :old_obs] = w[:, :old_obs]
        if has_priv:  # the coach's hidden-information inputs sit after the view
            new[:, new_obs:] = w[:, old_obs:]
        state[key] = new
    model.load_state_dict(state)
