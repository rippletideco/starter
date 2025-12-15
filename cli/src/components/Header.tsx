import React from 'react';
import { Box, Text } from 'ink';

export const Header: React.FC = () => {
  return (
    <Box flexDirection="column" marginBottom={2}>
      <Text bold color="#eba1b5">Rippletide Evaluation</Text>
      <Text color="gray">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
    </Box>
  );
};
