import { generateActionId } from "./contracts/actions.js";
import { BrowserError, BrowserErrorCode, toBrowserError } from "./contracts/errors.js";
import { mapErrorToCanonical } from "./error_mapper.js";
import { resolveSnapshotElement } from "./observation_engine.js";
import { verifyTypeAction, verifyCheckedState, verifyUrlChanged, verifyElementPresence } from "./action_verifier.js";

export type ActionDispatcher = (command: string, params: Record<string, any>) => Promise<any>;

export interface ClickInteractionParams {
  taskId: string;
  snapshotId?: string;
  elementId?: string;
  selector?: string;
  elementText?: string;
  x?: number;
  y?: number;
  skipVerification?: boolean;
}

export interface InteractionResult {
  actionId: string;
  success: boolean;
  verified: boolean;
  error?: { code: string; message: string; details?: Record<string, any> };
  [key: string]: any;
}

export async function executeInteractionClick(
  params: ClickInteractionParams,
  dispatcher: ActionDispatcher
): Promise<InteractionResult> {
  const actionId = generateActionId();

  let targetX = params.x;
  let targetY = params.y;
  let elementText = params.elementText;

  // Resolve element if elementId and snapshotId are provided
  if (params.snapshotId && params.elementId) {
    const resolved = resolveSnapshotElement(params.snapshotId, params.elementId);
    if (!resolved.ok) {
      return {
        actionId,
        success: false,
        verified: false,
        error: resolved.error.toJSON()
      };
    }
    const el = resolved.element;
    if (el.boundingBox) {
      targetX = el.boundingBox.x + el.boundingBox.width / 2;
      targetY = el.boundingBox.y + el.boundingBox.height / 2;
    }
    if (!elementText && el.text) {
      elementText = el.text;
    }
  }

  try {
    const result = await dispatcher("click", {
      elementId: params.elementId,
      selector: params.selector,
      elementText,
      x: targetX,
      y: targetY
    });

    return {
      actionId,
      success: true,
      verified: params.skipVerification ? false : (result.verified ?? true),
      clickedCoordinates: result.x !== undefined && result.y !== undefined ? { x: result.x, y: result.y } : (targetX !== undefined && targetY !== undefined ? { x: targetX, y: targetY } : undefined)
    };
  } catch (err: any) {
    const browserErr = mapErrorToCanonical(err);
    return {
      actionId,
      success: false,
      verified: false,
      error: browserErr.toJSON()
    };
  }
}

export interface TypeInteractionParams {
  taskId: string;
  snapshotId?: string;
  elementId?: string;
  selector?: string;
  text: string;
  clearFirst?: boolean;
  skipVerification?: boolean;
}

export async function executeInteractionType(
  params: TypeInteractionParams,
  dispatcher: ActionDispatcher
): Promise<InteractionResult> {
  const actionId = generateActionId();

  if (params.snapshotId && params.elementId) {
    const resolved = resolveSnapshotElement(params.snapshotId, params.elementId);
    if (!resolved.ok) {
      return {
        actionId,
        success: false,
        verified: false,
        error: resolved.error.toJSON()
      };
    }
  }

  try {
    const result = await dispatcher("type", {
      elementId: params.elementId,
      selector: params.selector,
      text: params.text,
      clear: params.clearFirst
    });

    let isVerified = params.skipVerification ? false : (result.verified ?? true);

    return {
      actionId,
      success: true,
      verified: isVerified,
      charactersTyped: result.length ?? params.text.length
    };
  } catch (err: any) {
    const browserErr = mapErrorToCanonical(err);
    return {
      actionId,
      success: false,
      verified: false,
      error: browserErr.toJSON()
    };
  }
}

export interface ClearInteractionParams {
  taskId: string;
  snapshotId?: string;
  elementId?: string;
  selector?: string;
}

export async function executeInteractionClear(
  params: ClearInteractionParams,
  dispatcher: ActionDispatcher
): Promise<InteractionResult> {
  const actionId = generateActionId();

  if (params.snapshotId && params.elementId) {
    const resolved = resolveSnapshotElement(params.snapshotId, params.elementId);
    if (!resolved.ok) {
      return {
        actionId,
        success: false,
        verified: false,
        error: resolved.error.toJSON()
      };
    }
  }

  try {
    const result = await dispatcher("clear", {
      elementId: params.elementId,
      selector: params.selector
    });

    return {
      actionId,
      success: true,
      verified: result.verified ?? true
    };
  } catch (err: any) {
    const browserErr = mapErrorToCanonical(err);
    return {
      actionId,
      success: false,
      verified: false,
      error: browserErr.toJSON()
    };
  }
}

export interface KeypressInteractionParams {
  taskId: string;
  key: string;
}

export async function executeInteractionKeypress(
  params: KeypressInteractionParams,
  dispatcher: ActionDispatcher
): Promise<InteractionResult> {
  const actionId = generateActionId();

  try {
    const result = await dispatcher("keypress", { key: params.key });
    return {
      actionId,
      success: true,
      verified: result.verified ?? true
    };
  } catch (err: any) {
    const browserErr = mapErrorToCanonical(err);
    return {
      actionId,
      success: false,
      verified: false,
      error: browserErr.toJSON()
    };
  }
}

export interface ScrollInteractionParams {
  taskId: string;
  distanceY: number;
}

export async function executeInteractionScroll(
  params: ScrollInteractionParams,
  dispatcher: ActionDispatcher
): Promise<InteractionResult> {
  const actionId = generateActionId();

  try {
    const result = await dispatcher("scroll", { distanceY: params.distanceY });
    return {
      actionId,
      success: true,
      verified: result.verified ?? true,
      distanceScrolled: result.distanceY ?? params.distanceY
    };
  } catch (err: any) {
    const browserErr = mapErrorToCanonical(err);
    return {
      actionId,
      success: false,
      verified: false,
      error: browserErr.toJSON()
    };
  }
}
